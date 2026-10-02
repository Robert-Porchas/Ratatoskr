import { it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  median,
  parseResults,
  savings,
} from '../benchmarks/browser-evidence/metrics.js';
import { summarizeMatrix } from '../benchmarks/browser-evidence/matrix-summary.js';
import { codexAccounting } from '../benchmarks/browser-evidence/usage.js';

it.each([
  ['production', 40],
  ['boundaries', 30],
  ['custom', 12],
  ['locator-repair', 6],
])(
  'reproduces published %s results from native usage, without estimates',
  async (suite, count) => {
    const root = 'benchmarks/browser-evidence/optimization/';
    const rows = parseResults(
      await readFile(root + suite + '-results.jsonl', 'utf8'),
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
      .parse(JSON.parse(await readFile(root + suite + '-usage.json', 'utf8')));
    expect(rows).toHaveLength(count);
    expect(new Set(rows.map((row) => row.codexThreadId)).size).toBe(count);
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
      if (row.scenario?.endsWith('http_failure'))
        expect(record.report).toMatchObject({
          method: 'POST',
          path: '/api/profile',
        });
    }
    expect(summarizeMatrix(rows).trimEnd()).toBe(
      (await readFile(root + suite + '-summary.md', 'utf8')).trimEnd(),
    );
  },
);

it('keeps the README token comparison tied to recorded production medians', async () => {
  const rows = parseResults(
    await readFile(
      'benchmarks/browser-evidence/optimization/production-results.jsonl',
      'utf8',
    ),
  );
  const readme = await readFile('README.md', 'utf8');
  for (const [scenario, label] of [
    ['medium-http_failure', 'Medium HTTP failure'],
    ['large-http_failure', 'Large HTTP failure'],
  ]) {
    const group = rows.filter((row) => row.scenario === scenario);
    const direct = group.filter((row) => row.mode === 'baseline');
    const rat = group.filter((row) => row.mode === 'ratatoskr');
    const a = median(direct.map((row) => row.totalTokens!))!;
    const b = median(rat.map((row) => row.totalTokens!))!;
    const cells = readme
      .split('\n')
      .find((line) => line.startsWith('| ' + label))!
      .split('|')
      .map((cell) => cell.trim());
    expect(cells.slice(1, 6)).toEqual([
      label,
      String(group[0]!.plannedSteps),
      a.toLocaleString('en-US'),
      b.toLocaleString('en-US'),
      savings(a, b)!.toFixed(1) + '%',
    ]);
    for (const records of [direct, rat])
      expect(cells[6]).toBe(
        `${records.filter((row) => row.diagnosisCorrect).length}/${records.length}`,
      );
  }
});
