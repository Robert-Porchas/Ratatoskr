import { expect, it } from 'vitest';
import { nativeCounts } from '../benchmarks/browser-evidence/publish-workflow.js';
import { codexAccounting } from '../benchmarks/browser-evidence/usage.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { parseResults } from '../benchmarks/browser-evidence/metrics.js';

it('publishes native accounting without tool bodies, credentials or thread IDs', () => {
  const events = [
    { type: 'thread.started', thread_id: 'private-thread' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { password: 'secret' } },
    {
      type: 'turn.completed',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cached_input_tokens: 50,
        reasoning_output_tokens: 10,
        unrelated: 'secret',
      },
    },
  ];
  expect(codexAccounting(nativeCounts(events))).toEqual(
    codexAccounting(events),
  );
  expect(JSON.stringify(nativeCounts(events))).not.toMatch(
    /secret|private-thread/,
  );
  expect(
    codexAccounting(
      nativeCounts([...events, { type: 'turn.failed', message: 'secret' }]),
    ).tokenAuthoritative,
  ).toBe(false);
});

it.each([
  ['pre', 2],
  ['pilot', 14],
  ['controlled-pre', 20],
  ['final', 140],
  ['legacy-final', 80],
  ['complex-final', 20],
  ['large-final', 20],
])(
  'audits all published %s tasks, including unsuccessful tasks',
  async (label, count) => {
    const root = `benchmarks/browser-evidence/workflow-intelligence/${label}`;
    const rows = parseResults(await readFile(`${root}/results.jsonl`, 'utf8'));
    const records = z
      .array(
        z.object({
          scenario: z.string(),
          mode: z.string(),
          run: z.number(),
          events: z.array(z.record(z.string(), z.unknown())),
        }),
      )
      .parse(
        (await readFile(`${root}/native-usage.jsonl`, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      );
    expect(rows).toHaveLength(count);
    expect(records).toHaveLength(count);
    for (const row of rows) {
      const record = records.find(
        (item) =>
          item.scenario === row.scenario &&
          item.mode === row.mode &&
          item.run === row.run,
      )!;
      expect(row).toMatchObject(codexAccounting(record.events));
      expect(row.codexThreadId).toBeUndefined();
    }
    if (label === 'pilot')
      expect(rows.filter((row) => !row.success)).toHaveLength(2);
    if (label === 'legacy-final')
      expect(rows.filter((row) => !row.tokenAuthoritative)).toHaveLength(3);
    if (label === 'final')
      expect(rows.filter((row) => !row.tokenAuthoritative)).toHaveLength(5);
  },
);
