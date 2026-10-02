import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseResults } from '../benchmarks/browser-evidence/metrics.js';
import {
  distribution,
  summarizeMatrix,
} from '../benchmarks/browser-evidence/matrix-summary.js';
import {
  startSettingsFixture,
  settingsContract,
  settingsTask,
} from '../benchmarks/browser-evidence/settings-fixture.js';

it('keeps increasing real form size and task/source facts identical across modes', () => {
  for (const size of ['tiny', 'small', 'medium', 'large'] as const) {
    const scenario = { size, outcome: 'http_failure' as const };
    const task = settingsTask(scenario);
    expect(task.plannedSteps).toBe(settingsContract(scenario).length * 2 + 2);
    expect(Object.keys(task.values)).toHaveLength(
      settingsContract(scenario).length,
    );
    expect(task.sourceContext).not.toContain('INTERNAL_ERROR');
  }
});

it('persists successful profiles across reload and keeps failures immutable', async () => {
  for (const outcome of ['success', 'http_failure'] as const) {
    const fixture = await startSettingsFixture({ size: 'medium', outcome });
    try {
      const fields = fixture.fields;
      expect(await (await fetch(fixture.url)).text()).toContain(
        'Jane Developer',
      );
      const response = await fetch(new URL('/api/profile', fixture.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          Object.fromEntries(fields.map((field) => [field.id, field.desired])),
        ),
      });
      expect(response.status).toBe(outcome === 'success' ? 200 : 500);
      if (outcome === 'http_failure')
        expect(await response.json()).toMatchObject({
          error: 'INTERNAL_ERROR',
        });
      const page = await (await fetch(fixture.url)).text();
      expect(page).toContain(
        outcome === 'success' ? 'Ratatoskr Test' : 'Jane Developer',
      );
      expect(fixture.stored().name).toBe(
        outcome === 'success' ? 'Ratatoskr Test' : 'Jane Developer',
      );
    } finally {
      await fixture.close();
    }
  }
});

it('calculates token distributions and refuses misleading matrix comparisons', async () => {
  expect(distribution([1, 3, 5])).toEqual({
    median: 3,
    min: 1,
    max: 5,
    mean: 3,
    standardDeviation: Math.sqrt(8 / 3),
  });
  expect(distribution([])).toBeNull();
  const rows = parseResults(
    await readFile(
      'benchmarks/browser-evidence/codex-sample/results.jsonl',
      'utf8',
    ),
  ).map((row) => ({
    ...row,
    scenario: 'medium-http_failure',
    baselineId: 'direct' as const,
    plannedSteps: 10,
  }));
  expect(summarizeMatrix(rows)).toContain('75.3%');
  expect(summarizeMatrix(rows)).toContain('Input tokens');
  expect(summarizeMatrix(rows)).toContain('not token savings');
  expect(() => summarizeMatrix(rows.slice(0, 1))).toThrow('Unpaired');
  expect(() =>
    summarizeMatrix(rows.map((row) => ({ ...row, scenario: '' }))),
  ).toThrow('Missing matrix');
  expect(() => summarizeMatrix([...rows, rows[0]!])).toThrow('Duplicate');
  expect(
    summarizeMatrix(
      rows.map((row) => ({
        ...row,
        tokenAuthoritative: false,
        totalTokens: null,
        inputTokens: null,
        outputTokens: null,
      })),
    ),
  ).toContain('N/A');
});
