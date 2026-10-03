import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { z } from 'zod';

const count = z.number().int().nonnegative();
const row = z.object({
  mode: z.string(),
  outcome: z.string(),
  inputTokens: count,
  outputTokens: count,
  totalTokens: count,
  cachedInputTokens: count,
  uncachedInputTokens: count,
  reasoningTokens: count,
  toolCalls: count,
  invalidCalls: count,
  correct: z.boolean(),
});

it('keeps distribution token claims tied to actual recorded task usage', () => {
  const record = z
    .object({ runs: z.array(row), prototype: z.object({ runs: z.array(row) }) })
    .parse(JSON.parse(readFileSync('docs/distribution-results.json', 'utf8')));
  const document = readFileSync('docs/distribution.md', 'utf8');
  for (const result of [...record.runs, ...record.prototype.runs]) {
    expect(result.totalTokens).toBe(result.inputTokens + result.outputTokens);
    expect(result.uncachedInputTokens).toBe(
      result.inputTokens - result.cachedInputTokens,
    );
    expect(result.reasoningTokens).toBeLessThanOrEqual(result.outputTokens);
    expect(result.correct).toBe(true);
  }
  const direct = record.runs.find((result) => result.mode === 'direct')!;
  const plugin = record.runs.find(
    (result) => result.mode === 'plugin' && result.outcome === 'http_failure',
  )!;
  const control = record.runs.find((result) => result.mode === 'control')!;
  expect(document).toContain(
    `${((1 - plugin.totalTokens / direct.totalTokens) * 100).toFixed(1)}% below direct`,
  );
  expect(document).toContain(
    `${((plugin.totalTokens / control.totalTokens - 1) * 100).toFixed(1)}% above manual`,
  );
  for (const result of record.runs)
    expect(document).toContain(result.totalTokens.toLocaleString('en-US'));
});
