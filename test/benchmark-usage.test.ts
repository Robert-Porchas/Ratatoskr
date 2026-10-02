import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  parseResults,
  summarize,
} from '../benchmarks/browser-evidence/metrics.js';
import { observedFailure } from '../benchmarks/browser-evidence/agent.js';
import {
  codexAccounting,
  providerAccounting,
  UsageSchema,
} from '../benchmarks/browser-evidence/usage.js';

const events = (usage: unknown) => [
  { type: 'thread.started', thread_id: 'isolated-thread' },
  { type: 'turn.started' },
  { type: 'turn.completed', usage },
];

it('aggregates all API invocations and keeps cache/reasoning as subsets', () => {
  expect(
    providerAccounting([
      {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 40 },
        output_tokens_details: { reasoning_tokens: 10 },
      },
      {
        input_tokens: 300,
        output_tokens: 50,
        total_tokens: 350,
        input_tokens_details: { cached_tokens: 200 },
        output_tokens_details: { reasoning_tokens: 25 },
      },
    ]),
  ).toMatchObject({
    tokenSource: 'openai-api',
    tokenAuthoritative: true,
    inputTokens: 400,
    outputTokens: 70,
    totalTokens: 470,
    cachedInputTokens: 240,
    uncachedInputTokens: 160,
    reasoningTokens: 35,
  });
});

it('uses one isolated Codex completed-turn total without summing repeated events', () => {
  const stream = events({
    input_tokens: 1000,
    output_tokens: 100,
    cached_input_tokens: 800,
    reasoning_output_tokens: 40,
  });
  expect(codexAccounting(stream)).toMatchObject({
    tokenSource: 'codex-json-events',
    tokenAuthoritative: true,
    tokenScope: 'isolated-codex-task',
    inputTokens: 1000,
    outputTokens: 100,
    totalTokens: 1100,
    cachedInputTokens: 800,
    uncachedInputTokens: 200,
    reasoningTokens: 40,
  });
  expect(codexAccounting([...stream, stream[2]!]).tokenAuthoritative).toBe(
    false,
  );
  expect(
    codexAccounting([...stream, { type: 'turn.started' }]).totalTokens,
  ).toBeNull();
});

it('does not infer optional usage or tokens from browser bytes', () => {
  const missing = codexAccounting(
    events({ input_tokens: 5, output_tokens: 2 }),
  );
  expect(missing.totalTokens).toBe(7);
  expect(missing.cachedInputTokens).toBeNull();
  expect(missing.uncachedInputTokens).toBeNull();
  expect(missing.reasoningTokens).toBeNull();
  expect(codexAccounting(events(null)).tokenAuthoritative).toBe(false);
  expect(() =>
    codexAccounting(
      events({ rawEvidenceBytes: 10000, modelEvidenceBytes: 4000 }),
    ),
  ).toThrow();
  expect(providerAccounting([null]).totalTokens).toBeNull();
});

it('rejects malformed totals and impossible subset counts', () => {
  expect(() =>
    codexAccounting(events({ input_tokens: -1, output_tokens: 2 })),
  ).toThrow();
  expect(() =>
    codexAccounting(
      events({ input_tokens: 5, output_tokens: 2, total_tokens: 999 }),
    ),
  ).toThrow();
  expect(() =>
    codexAccounting(
      events({ input_tokens: 5, output_tokens: 2, cached_input_tokens: 6 }),
    ),
  ).toThrow();
  expect(() =>
    UsageSchema.parse({
      input_tokens: 5,
      output_tokens: 2,
      total_tokens: 7,
      output_tokens_details: { reasoning_tokens: 3 },
    }),
  ).toThrow();
  expect(() => codexAccounting(events({ rawEvidenceBytes: 1000 }))).toThrow();
});

it('reproduces the live sample from native usage and preserved evidence', async () => {
  const root = 'benchmarks/browser-evidence/codex-sample/';
  const rows = parseResults(await readFile(root + 'results.jsonl', 'utf8'));
  const original = parseResults(
    await readFile(root + 'original-results.jsonl', 'utf8'),
  );
  expect(new Set(rows.map((row) => row.codexThreadId)).size).toBe(2);
  for (const row of rows) {
    const raw = (
      await readFile(root + `${row.mode}-1/codex-events.jsonl`, 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(row).toMatchObject(codexAccounting(raw));
    const prior = original.find((value) => value.mode === row.mode)!;
    for (const field of [
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'rawEvidenceBytes',
      'modelEvidenceBytes',
      'returnedEvidenceBytes',
    ] as const)
      expect(row[field]).toBe(prior[field]);
    const interactions = (
      await readFile(root + `${row.mode}-1/interactions.jsonl`, 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { reply: { text: string } });
    expect(
      observedFailure(interactions.map((value) => value.reply.text))
        .persistenceFailure,
    ).toBe(true);
    expect(row.success).toBe(true);
    expect(row.diagnosisCorrect).toBe(true);
  }
  expect(summarize(rows)).toBe(await readFile(root + 'summary.md', 'utf8'));
});
