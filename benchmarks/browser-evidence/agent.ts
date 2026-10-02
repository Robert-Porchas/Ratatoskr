import { z } from 'zod';
import {
  ReportSchema,
  UsageSchema,
  type DiagnosisReport,
  type Usage,
} from './metrics.js';
import type { ToolDefinition, ToolReply } from './tools.js';

export interface Interaction {
  index: number;
  name: string;
  arguments: Record<string, unknown>;
  reply: ToolReply;
  durationMs: number;
}
export interface ModelTurn {
  index: number;
  request: Record<string, unknown>;
  output: Record<string, unknown>[];
  usage: Usage | null;
  resolvedModel: string;
}
export type Provider = (
  request: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;
export const finishTool: ToolDefinition = {
  name: 'report_diagnosis',
  description:
    'Finish the task with the observed persistence result and concrete browser evidence. Do not guess a cause without evidence.',
  inputSchema: z.toJSONSchema(ReportSchema),
};
const ResponseSchema = z.object({
  model: z.string(),
  output: z.array(z.record(z.string(), z.unknown())),
  usage: UsageSchema.nullable().optional(),
});

/** No SDK dependency: usage comes from each Responses API response, never transcript tokenization. */
export const openaiProvider: Provider = async (request, signal) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Model mode requires OPENAI_API_KEY');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok)
    throw new Error(`OpenAI request failed: HTTP ${response.status}`);
  return response.json();
};

export interface ModelOptions {
  model: string;
  prompt: string;
  instructions: string;
  tools: ToolDefinition[];
  maxTurns: number;
  maxToolCalls: number;
  maxOutputTokens: number;
  signal: AbortSignal;
  call: (name: string, args: Record<string, unknown>) => Promise<ToolReply>;
  recordTurn: (turn: ModelTurn) => Promise<void>;
  beforeTurn: () => void;
}

/** Carry every output item, including encrypted reasoning, into subsequent requests. */
export async function runModel(
  options: ModelOptions,
  provider: Provider = openaiProvider,
): Promise<DiagnosisReport> {
  const history: unknown[] = [{ role: 'user', content: options.prompt }];
  const tools = [...options.tools, finishTool].map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }));
  let toolCalls = 0;
  for (let index = 1; index <= options.maxTurns; index++) {
    options.signal.throwIfAborted();
    const request = {
      model: options.model,
      instructions: options.instructions,
      input: [...history],
      tools,
      parallel_tool_calls: false,
      max_output_tokens: options.maxOutputTokens,
      store: false,
      include: ['reasoning.encrypted_content'],
    };
    options.beforeTurn();
    const response = ResponseSchema.parse(
      await provider(request, options.signal),
    );
    await options.recordTurn({
      index,
      request,
      output: response.output,
      usage: response.usage ?? null,
      resolvedModel: response.model,
    });
    history.push(...response.output);
    let called = false;
    for (const item of response.output) {
      if (item.type !== 'function_call') continue;
      called = true;
      toolCalls++;
      if (toolCalls > options.maxToolCalls)
        throw new Error('Maximum tool calls exceeded');
      if (
        typeof item.name !== 'string' ||
        typeof item.arguments !== 'string' ||
        typeof item.call_id !== 'string'
      )
        throw new Error('Malformed provider tool call');
      const args = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(item.arguments));
      if (item.name === finishTool.name) return ReportSchema.parse(args);
      const reply = await options.call(item.name, args);
      history.push({
        type: 'function_call_output',
        call_id: item.call_id,
        output: reply.images?.length
          ? [
              { type: 'input_text', text: reply.text },
              ...reply.images.map((image) => ({
                type: 'input_image',
                image_url: `data:${image.mimeType};base64,${image.data}`,
              })),
            ]
          : reply.text,
      });
    }
    if (!called) throw new Error('Model ended without report_diagnosis');
  }
  throw new Error('Maximum model turns exceeded');
}

/** Scripted local replay validates the plumbing; it makes no model or token claims. */
export async function runReplay(
  mode: 'baseline' | 'ratatoskr',
  url: string,
  call: ModelOptions['call'],
): Promise<DiagnosisReport> {
  const observations: string[] = [];
  const invoke = async (name: string, args: Record<string, unknown>) => {
    const reply = await call(name, args);
    observations.push(reply.text);
    return reply;
  };
  if (mode === 'baseline') {
    await invoke('browser_navigate', { url });
    await invoke('browser_fill', {
      target: { kind: 'label', label: 'Name' },
      value: 'Ratatoskr Test',
    });
    await invoke('browser_click', {
      target: { kind: 'role', role: 'button', name: 'Save' },
    });
    await invoke('browser_network', {});
    await invoke('browser_console', {});
    await invoke('browser_navigate', { url });
  } else {
    await invoke('run_browser_workflow', {
      startUrl: url,
      timeoutMs: 15_000,
      steps: [
        {
          action: 'fill',
          target: { kind: 'label', label: 'Name' },
          valueRef: 'BENCHMARK_NAME',
        },
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Save' },
        },
        {
          action: 'assert_text',
          target: { kind: 'testId', testId: 'persisted-name' },
          contains: 'Ratatoskr Test',
          timeoutMs: 500,
        },
      ],
    });
  }
  // Diagnose only from actual returned observations. Never read fixture internals to construct a report.
  const found = observedFailure(observations);
  if (!found.http || !found.code || !found.persistenceFailure)
    throw new Error(
      'Returned evidence is insufficient for the replay diagnosis',
    );
  return {
    persisted: false,
    method: found.http.method,
    path: found.http.path,
    status: found.http.status,
    errorCode: found.code,
    evidence: [JSON.stringify(found.http), found.message ?? found.code],
  };
}

export function observedFailure(observations: string[]) {
  let http: { method: string; path: string; status: number } | undefined;
  let code: string | undefined, message: string | undefined;
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.includes('Failed to save profile: ')) {
        const match = /Failed to save profile: ([A-Z_]+)/.exec(value);
        if (match) {
          code = match[1];
          message = match[0];
        }
      }
      if (value.startsWith('{')) {
        try {
          visit(JSON.parse(value));
        } catch {
          /* ordinary text */
        }
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      if (
        object.method === 'POST' &&
        object.path === '/api/profile' &&
        typeof object.status === 'number'
      )
        http = { method: 'POST', path: '/api/profile', status: object.status };
      if (typeof object.error === 'string' && object.error === 'INTERNAL_ERROR')
        code = object.error;
      Object.values(object).forEach(visit);
    }
  };
  observations.forEach((value) => {
    try {
      visit(JSON.parse(value));
    } catch {
      /* tool error */
    }
  });
  const joined = observations.join('\n');
  const persistenceFailure =
    joined.includes('Unable to save profile.') ||
    joined.includes('Expected text to contain Ratatoskr Test') ||
    (http?.status === 500 && code === 'INTERNAL_ERROR');
  return { http, code, message, persistenceFailure };
}
