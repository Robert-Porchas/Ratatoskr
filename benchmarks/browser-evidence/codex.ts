import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ReportSchema, type DiagnosisReport } from './metrics.js';
import { codexAccounting, type TokenAccounting } from './usage.js';

interface CodexOptions {
  mode: 'baseline' | 'ratatoskr';
  url: string;
  directory: string;
  prompt: string;
  model: string;
  signal: AbortSignal;
  reasoningEffort: string;
  sourceContext?: string;
  values?: Record<string, string>;
  baseline?: 'direct' | 'playwright';
}

/** This launches a fresh task, never resumes this development conversation or a prior benchmark. */
export async function runCodex(options: CodexOptions): Promise<{
  report: DiagnosisReport | undefined;
  accounting: TokenAccounting;
  events: Array<Record<string, unknown>>;
  threadId: string | undefined;
  error: string | undefined;
}> {
  const workspace = await mkdtemp(join(tmpdir(), 'ratatoskr-codex-task-'));
  const schemaPath = join(options.directory, 'diagnosis-schema.json');
  await writeFile(schemaPath, JSON.stringify(z.toJSONSchema(ReportSchema)));
  const finalPath = join(options.directory, 'codex-final.json');
  const config = {
    command: process.execPath,
    args: [fileURLToPath(new URL('./codex-tools.js', import.meta.url))],
    env: {
      BENCHMARK_MODE: options.mode,
      BENCHMARK_FIXTURE_URL: options.url,
      BENCHMARK_DIRECTORY: options.directory,
      ...(options.baseline ? { BENCHMARK_BASELINE: options.baseline } : {}),
      ...(options.values
        ? { BENCHMARK_VALUES: JSON.stringify(options.values) }
        : {}),
    },
  };
  const envTable = Object.entries(config.env)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(',');
  // Unattended approval is scoped to this fixture-only server, not global tools.
  const mcp = `{benchmark={command=${JSON.stringify(config.command)},args=${JSON.stringify(config.args)},env={${envTable}},required=true,default_tools_approval_mode="approve",startup_timeout_sec=20,tool_timeout_sec=60}}`;
  const instructions = `You are testing a local application. Profile page: ${options.url}. Desired name is available locally as valueRef BENCHMARK_NAME. Perform the task using only the benchmark MCP browser tools. Use condition-based assertions; workflow completion alone does not prove persistence. Inspect only evidence needed for diagnosis. Do not run setup commands. Finish with the structured diagnosis requested by the output schema, supported by browser evidence. ${options.sourceContext ?? ''}`;
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--cd',
    workspace,
    '--model',
    options.model,
    '--output-schema',
    schemaPath,
    '--output-last-message',
    finalPath,
    '-c',
    `developer_instructions=${JSON.stringify(instructions)}`,
    '-c',
    `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`,
    '-c',
    'project_doc_max_bytes=0',
    '-c',
    'web_search="disabled"',
    '-c',
    `mcp_servers=${mcp}`,
    ...[
      'shell_tool',
      'multi_agent',
      'plugins',
      'apps',
      'browser_use',
      'computer_use',
      'image_generation',
      'view_image',
      'skill_search',
      'goals',
    ].flatMap((feature) => ['--disable', feature]),
    '-',
  ];
  await mkdir(options.directory, { recursive: true });
  // Record reproducible options, never authentication environment/header values.
  await writeFile(
    join(options.directory, 'codex-launch.json'),
    JSON.stringify(
      {
        args,
        prompt: options.prompt,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
      },
      null,
      2,
    ),
  );
  const environment = { ...process.env };
  delete environment.CODEX_THREAD_ID;
  delete environment.CODEX_SESSION_ID;
  const child = spawn('codex', args, {
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const events: Array<Record<string, unknown>> = [];
  let error: string | undefined;
  const terminate = () => {
    if (child.pid && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already exited */
      }
    } else child.kill('SIGTERM');
  };
  options.signal.addEventListener('abort', terminate, { once: true });
  const stderr: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const lines = createInterface({ input: child.stdout });
  let startedToolCalls = 0;
  const capture = (async () => {
    for await (const line of lines) {
      await appendFile(
        join(options.directory, 'codex-events.jsonl'),
        line + '\n',
      );
      try {
        const event = z.record(z.string(), z.unknown()).parse(JSON.parse(line));
        events.push(event);
        const item = z.record(z.string(), z.unknown()).safeParse(event.item);
        if (
          event.type === 'item.started' &&
          item.success &&
          item.data.type === 'mcp_tool_call' &&
          ++startedToolCalls > 24
        ) {
          error ??= 'Maximum browser tool calls exceeded';
          terminate();
        }
      } catch {
        error ??= 'Malformed Codex JSON event';
      }
    }
  })();
  try {
    child.stdin.end(options.prompt);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    await capture;
    if (code !== 0) error ??= `Codex exited with code ${code}`;
    if (options.signal.aborted) error ??= 'Codex task timed out';
    let report: DiagnosisReport | undefined;
    try {
      report = ReportSchema.parse(
        JSON.parse(await readFile(finalPath, 'utf8')),
      );
    } catch {
      error ??= 'Codex did not produce a valid final diagnosis';
    }
    const rawUsage = events.filter((event) => event.type === 'turn.completed');
    await writeFile(
      join(options.directory, 'codex-usage.json'),
      JSON.stringify(rawUsage, null, 2),
    );
    const accounting = codexAccounting(events);
    const started = events.find((event) => event.type === 'thread.started');
    return {
      report,
      accounting,
      events,
      threadId:
        typeof started?.thread_id === 'string' ? started.thread_id : undefined,
      error,
    };
  } finally {
    options.signal.removeEventListener('abort', terminate);
    terminate();
    await writeFile(
      join(options.directory, 'codex-stderr.log'),
      Buffer.concat(stderr),
    );
    await rm(workspace, { recursive: true, force: true });
  }
}
