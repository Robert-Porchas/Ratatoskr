import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { parseResults } from '../benchmarks/browser-evidence/metrics.js';
import { summarizeMatrix } from '../benchmarks/browser-evidence/matrix-summary.js';
import { codexAccounting } from '../benchmarks/browser-evidence/usage.js';

it('reproduces published production token results from native usage, without estimates', async () => {
  const root = 'benchmarks/browser-evidence/optimization/';
  const rows = parseResults(
    await readFile(root + 'production-results.jsonl', 'utf8'),
  );
  const native = z
    .array(
      z.object({
        mode: z.string(),
        run: z.number(),
        scenario: z.string(),
        threadId: z.string(),
        events: z.array(z.record(z.string(), z.unknown())),
        report: z.object({ method: z.string(), path: z.string() }),
      }),
    )
    .parse(JSON.parse(await readFile(root + 'production-usage.json', 'utf8')));
  expect(rows).toHaveLength(40);
  expect(new Set(rows.map((row) => row.codexThreadId)).size).toBe(40);
  for (const row of rows) {
    const record = native.find(
      (item) =>
        item.mode === row.mode &&
        item.run === row.run &&
        item.scenario === row.scenario,
    )!;
    expect(record.threadId).toBe(row.codexThreadId);
    expect(row).toMatchObject(
      codexAccounting([
        { type: 'thread.started', thread_id: record.threadId },
        { type: 'turn.started' },
        ...record.events,
      ]),
    );
    expect(record.report).toMatchObject({
      method: 'POST',
      path: '/api/profile',
    });
  }
  expect(summarizeMatrix(rows)).toBe(
    await readFile(root + 'production-summary.md', 'utf8'),
  );
});
