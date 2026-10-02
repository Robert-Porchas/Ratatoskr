import { z } from 'zod';
import { providerAccounting, type Usage } from './usage.js';
export { UsageSchema, type Usage } from './usage.js';

const count = z.number().int().nonnegative();
export function cumulativeUsage(turns: Array<Usage | null>) {
  const { inputTokens, outputTokens, totalTokens } = providerAccounting(turns);
  return { inputTokens, outputTokens, totalTokens };
}

export const ReportSchema = z.strictObject({
  persisted: z.boolean(),
  method: z.string(),
  path: z.string(),
  status: count,
  errorCode: z.string(),
  evidence: z.array(z.string()).min(1).max(5),
});
export type DiagnosisReport = z.infer<typeof ReportSchema>;

export const ResultSchema = z.object({
  benchmarkVersion: z.literal('1'),
  suiteId: z.string(),
  mode: z.enum(['baseline', 'ratatoskr']),
  driver: z.enum(['replay', 'model', 'codex']),
  run: count.min(1),
  timestamp: z.string(),
  gitCommit: z.string(),
  configurationHash: z.string(),
  model: z.string().nullable(),
  browserVersion: z.string(),
  success: z.boolean(),
  diagnosisCorrect: z.boolean(),
  criteria: z.record(z.string(), z.boolean()),
  modelCalls: count.nullable(),
  toolInteractions: count,
  browserInteractions: count,
  inputTokens: count.nullable(),
  outputTokens: count.nullable(),
  totalTokens: count.nullable(),
  tokenSource: z.enum([
    'provider',
    'openai-api',
    'codex-json-events',
    'unavailable',
  ]),
  tokenAuthoritative: z.boolean().optional(),
  tokenScope: z
    .enum(['model-invocations', 'isolated-codex-task', 'unavailable'])
    .optional(),
  cachedInputTokens: count.nullable().optional(),
  uncachedInputTokens: count.nullable().optional(),
  reasoningTokens: count.nullable().optional(),
  codexVersion: z.string().optional(),
  codexThreadId: z.string().optional(),
  scenario: z.string().optional(),
  plannedSteps: count.optional(),
  baselineId: z.enum(['direct', 'playwright']).optional(),
  rawEvidenceBytes: count,
  artifactBytes: count,
  modelEvidenceBytes: count.nullable(),
  returnedEvidenceBytes: count,
  cumulativeContextEvidenceBytes: count.nullable(),
  toolDefinitionsBytes: count,
  invalidToolCalls: count.optional(),
  failedToolCalls: count.optional(),
  toolArgumentBytes: count.optional(),
  toolResultBytes: count.optional(),
  maxToolErrorBytes: count.optional(),
  schemaByTool: z
    .array(
      z.object({
        name: z.string(),
        inputSchemaBytes: count,
        descriptionBytes: count,
        definitionBytes: count,
      }),
    )
    .optional(),
  durationMs: count,
  error: z.string().optional(),
});
export type BenchmarkResult = z.infer<typeof ResultSchema>;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function savings(
  baseline: number | null,
  ratatoskr: number | null,
): number | null {
  return baseline === null || baseline <= 0 || ratatoskr === null
    ? null
    : (1 - ratatoskr / baseline) * 100;
}

/** Refuse mixed experiments or partial token coverage instead of publishing favorable subsets. */
export function summarize(results: BenchmarkResult[]): string {
  if (!results.length) throw new Error('No benchmark results');
  if (
    new Set(
      results.map(
        (row) =>
          `${row.suiteId}:${row.configurationHash}:${row.gitCommit}:${row.browserVersion}:${row.driver}:${row.model}`,
      ),
    ).size !== 1
  )
    throw new Error(
      'Mixed configurations/suites; summarize one experiment at a time',
    );
  const sources = new Set(
    results
      .filter((row) => row.tokenSource !== 'unavailable')
      .map((row) =>
        row.tokenSource === 'provider' ? 'openai-api' : row.tokenSource,
      ),
  );
  if (sources.size > 1) throw new Error('Mixed token accounting sources');
  if (new Set(results.map((row) => row.codexVersion ?? '')).size !== 1)
    throw new Error('Mixed Codex versions');
  if (
    new Set(results.map((row) => `${row.mode}:${row.run}`)).size !==
    results.length
  )
    throw new Error('Duplicate run identifiers');
  const baseline = results.filter((row) => row.mode === 'baseline');
  const ratatoskr = results.filter((row) => row.mode === 'ratatoskr');
  if (!baseline.length || !ratatoskr.length)
    throw new Error('Both modes are required');
  if (
    baseline.length !== ratatoskr.length ||
    baseline.some((row) => !ratatoskr.some((other) => other.run === row.run))
  )
    throw new Error('Paired run counts do not match');
  const metric = (
    rows: BenchmarkResult[],
    key: keyof BenchmarkResult,
  ): number | null => {
    const values = rows.map((row) => row[key]);
    return values.every((value) => typeof value === 'number')
      ? median(values as number[])
      : null;
  };
  const format = (value: number | null): string =>
    value === null
      ? 'N/A'
      : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
  const rows = [
    `| Task criteria met | ${baseline.filter((row) => row.success).length}/${baseline.length} | ${ratatoskr.filter((row) => row.success).length}/${ratatoskr.length} | — |`,
    `| Correct diagnosis | ${baseline.filter((row) => row.diagnosisCorrect).length}/${baseline.length} | ${ratatoskr.filter((row) => row.diagnosisCorrect).length}/${ratatoskr.length} | — |`,
  ];
  const metrics: Array<[string, keyof BenchmarkResult, boolean]> = [
    ['Median input tokens', 'inputTokens', true],
    ['Median output tokens', 'outputTokens', true],
    ['Median total tokens', 'totalTokens', true],
    [
      'Median cached input tokens (included in input)',
      'cachedInputTokens',
      false,
    ],
    ['Median uncached input tokens', 'uncachedInputTokens', false],
    ['Median reasoning tokens (included in output)', 'reasoningTokens', false],
    ['Median model calls', 'modelCalls', false],
    ['Median tool interactions', 'toolInteractions', true],
    [
      'Median browser operations (including observations/assertions)',
      'browserInteractions',
      true,
    ],
    [
      'Median evidence inserted into model context (bytes)',
      'modelEvidenceBytes',
      true,
    ],
    ['Median returned evidence (bytes)', 'returnedEvidenceBytes', true],
    [
      'Median cumulative context evidence (bytes)',
      'cumulativeContextEvidenceBytes',
      true,
    ],
    [
      'Median local event evidence (bytes; capture differs by mode)',
      'rawEvidenceBytes',
      false,
    ],
    ['Median local binary artifacts (bytes)', 'artifactBytes', false],
    ['Tool definitions (bytes)', 'toolDefinitionsBytes', false],
    ['Median elapsed time (ms)', 'durationMs', false],
  ];
  for (const [label, key, compare] of metrics) {
    const a = metric(baseline, key),
      b = metric(ratatoskr, key);
    const percent = compare ? savings(a, b) : null;
    rows.push(
      `| ${label} | ${format(a)} | ${format(b)} | ${percent === null ? '—' : `${format(percent)}% reduction`} |`,
    );
  }
  const accounting =
    results[0]?.driver === 'codex'
      ? 'Token accounting: Codex-reported turn.completed.usage from one fresh process/thread per task. This is the completed user-turn total across internal model calls; model-call counts and per-invocation usage are not exposed by this CLI stream. Total tokens = reported input + reported output; cached input and reasoning output are subsets, not additions.'
      : results[0]?.driver === 'replay'
        ? 'Token accounting: unavailable (offline replay). No model was invoked. Token/context metrics are unavailable; returned evidence measures tool payloads only.'
        : 'Token accounting: OpenAI Responses API usage, summed across every invocation. Repeated history and tool definitions are included. Missing usage makes aggregate token metrics unavailable.';
  return `<!-- Generated from recorded runs; do not edit measurements. -->\n\nConfiguration: ${results[0]?.driver}; model: ${results[0]?.model ?? 'none'}; browser: ${results[0]?.browserVersion}; commit: ${results[0]?.gitCommit}; Codex: ${results[0]?.codexVersion ?? 'not used'}; runs: ${baseline.length} per mode; started: ${results.map((row) => row.timestamp).sort()[0]}.\n\n${accounting}\n\n| Metric | Direct browser | Ratatoskr | Change |\n| --- | ---: | ---: | ---: |\n${rows.join('\n')}\n`;
}

export function parseResults(jsonl: string): BenchmarkResult[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        const result = ResultSchema.parse(JSON.parse(line));
        if (
          ['provider', 'openai-api', 'codex-json-events'].includes(
            result.tokenSource,
          ) &&
          result.tokenAuthoritative !== false &&
          (result.totalTokens === null ||
            result.inputTokens === null ||
            result.outputTokens === null ||
            result.totalTokens !== result.inputTokens + result.outputTokens)
        )
          throw new Error('Invalid provider totals');
        if (
          result.tokenAuthoritative === false &&
          [result.inputTokens, result.outputTokens, result.totalTokens].some(
            (value) => value !== null,
          )
        )
          throw new Error('Unavailable authoritative metrics must be null');
        if (
          result.cachedInputTokens !== undefined &&
          result.cachedInputTokens !== null &&
          (result.inputTokens === null ||
            result.cachedInputTokens > result.inputTokens)
        )
          throw new Error('Invalid cached tokens');
        if (
          result.uncachedInputTokens !== undefined &&
          result.uncachedInputTokens !== null &&
          result.uncachedInputTokens !==
            (result.inputTokens ?? 0) - (result.cachedInputTokens ?? 0)
        )
          throw new Error('Invalid uncached tokens');
        if (
          result.reasoningTokens !== undefined &&
          result.reasoningTokens !== null &&
          (result.outputTokens === null ||
            result.reasoningTokens > result.outputTokens)
        )
          throw new Error('Invalid reasoning tokens');
        if (
          result.tokenSource === 'unavailable' &&
          [result.inputTokens, result.outputTokens, result.totalTokens].some(
            (value) => value !== null,
          )
        )
          throw new Error('Unavailable tokens must be null');
        if (
          result.driver === 'replay' &&
          (result.modelCalls !== 0 || result.modelEvidenceBytes !== null)
        )
          throw new Error('Replay cannot claim model measurements');
        return result;
      } catch {
        throw new Error(`Invalid benchmark record at line ${index + 1}`);
      }
    });
}
