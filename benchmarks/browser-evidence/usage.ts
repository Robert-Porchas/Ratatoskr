import { z } from 'zod';

const count = z.number().int().nonnegative();
export const UsageSchema = z
  .object({
    input_tokens: count,
    output_tokens: count,
    total_tokens: count,
    input_tokens_details: z
      .object({ cached_tokens: count.optional() })
      .optional(),
    output_tokens_details: z
      .object({ reasoning_tokens: count.optional() })
      .optional(),
  })
  .superRefine((usage, context) => {
    if (usage.total_tokens !== usage.input_tokens + usage.output_tokens)
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent provider token totals',
      });
    if ((usage.input_tokens_details?.cached_tokens ?? 0) > usage.input_tokens)
      context.addIssue({
        code: 'custom',
        message: 'Cached tokens exceed input tokens',
      });
    if (
      (usage.output_tokens_details?.reasoning_tokens ?? 0) > usage.output_tokens
    )
      context.addIssue({
        code: 'custom',
        message: 'Reasoning tokens exceed output tokens',
      });
  });
export type Usage = z.infer<typeof UsageSchema>;

export interface TokenAccounting {
  tokenSource: 'openai-api' | 'codex-json-events' | 'unavailable';
  tokenAuthoritative: boolean;
  tokenScope: 'model-invocations' | 'isolated-codex-task' | 'unavailable';
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  uncachedInputTokens: number | null;
  reasoningTokens: number | null;
}

export function unavailableUsage(
  source: TokenAccounting['tokenSource'] = 'unavailable',
): TokenAccounting {
  return {
    tokenSource: source,
    tokenAuthoritative: false,
    tokenScope: 'unavailable',
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cachedInputTokens: null,
    uncachedInputTokens: null,
    reasoningTokens: null,
  };
}

function sumOptional(values: Array<number | undefined>): number | null {
  return values.every((value) => value !== undefined)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
}

export function providerAccounting(
  turns: Array<Usage | null>,
): TokenAccounting {
  if (!turns.length || turns.some((turn) => turn === null))
    return unavailableUsage('openai-api');
  const parsed = turns.map((turn) => UsageSchema.parse(turn));
  const inputTokens = parsed.reduce((sum, turn) => sum + turn.input_tokens, 0);
  const outputTokens = parsed.reduce(
    (sum, turn) => sum + turn.output_tokens,
    0,
  );
  const cachedInputTokens = sumOptional(
    parsed.map((turn) => turn.input_tokens_details?.cached_tokens),
  );
  return {
    tokenSource: 'openai-api',
    tokenAuthoritative: true,
    tokenScope: 'model-invocations',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens,
    uncachedInputTokens:
      cachedInputTokens === null ? null : inputTokens - cachedInputTokens,
    reasoningTokens: sumOptional(
      parsed.map((turn) => turn.output_tokens_details?.reasoning_tokens),
    ),
  };
}

const CodexUsageSchema = z
  .object({
    input_tokens: count,
    output_tokens: count,
    cached_input_tokens: count.optional(),
    reasoning_output_tokens: count.optional(),
    total_tokens: count.optional(),
  })
  .superRefine((usage, context) => {
    if (
      usage.total_tokens !== undefined &&
      usage.total_tokens !== usage.input_tokens + usage.output_tokens
    )
      context.addIssue({ code: 'custom', message: 'Inconsistent Codex total' });
    if ((usage.cached_input_tokens ?? 0) > usage.input_tokens)
      context.addIssue({
        code: 'custom',
        message: 'Cached tokens exceed input tokens',
      });
    if ((usage.reasoning_output_tokens ?? 0) > usage.output_tokens)
      context.addIssue({
        code: 'custom',
        message: 'Reasoning tokens exceed output tokens',
      });
  });

/** One fresh CLI task must emit exactly one completed user-turn total, covering its internal model calls. */
export function codexAccounting(
  events: Array<Record<string, unknown>>,
): TokenAccounting {
  const started = events.filter((event) => event.type === 'thread.started');
  const turns = events.filter((event) => event.type === 'turn.started');
  const completed = events.filter((event) => event.type === 'turn.completed');
  if (
    started.length !== 1 ||
    turns.length !== 1 ||
    completed.length !== 1 ||
    events.some((event) => event.type === 'turn.failed')
  )
    return unavailableUsage('codex-json-events');
  if (completed[0]?.usage === null || completed[0]?.usage === undefined)
    return unavailableUsage('codex-json-events');
  const usage = CodexUsageSchema.parse(completed[0].usage);
  const cachedInputTokens = usage.cached_input_tokens ?? null;
  return {
    tokenSource: 'codex-json-events',
    tokenAuthoritative: true,
    tokenScope: 'isolated-codex-task',
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens ?? usage.input_tokens + usage.output_tokens,
    cachedInputTokens,
    uncachedInputTokens:
      cachedInputTokens === null
        ? null
        : usage.input_tokens - cachedInputTokens,
    reasoningTokens: usage.reasoning_output_tokens ?? null,
  };
}
