import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { startProfileFixture } from '../benchmarks/browser-evidence/fixture.js';
import {
  cumulativeUsage,
  median,
  parseResults,
  savings,
  summarize,
  type BenchmarkResult,
} from '../benchmarks/browser-evidence/metrics.js';

function result(
  mode: 'baseline' | 'ratatoskr',
  run: number,
  tokens: number | null,
): BenchmarkResult {
  return {
    benchmarkVersion: '1',
    suiteId: 'test',
    mode,
    driver: 'model',
    run,
    timestamp: '2026-10-01',
    gitCommit: 'abc',
    configurationHash: 'same',
    model: 'test-model',
    browserVersion: 'test-browser',
    success: true,
    diagnosisCorrect: true,
    criteria: {},
    modelCalls: 2,
    toolInteractions: 3,
    browserInteractions: 4,
    inputTokens: tokens,
    outputTokens: tokens === null ? null : 0,
    totalTokens: tokens,
    tokenSource: tokens === null ? 'unavailable' : 'provider',
    rawEvidenceBytes: 100,
    artifactBytes: 0,
    modelEvidenceBytes: tokens,
    returnedEvidenceBytes: 100,
    cumulativeContextEvidenceBytes: tokens,
    toolDefinitionsBytes: 100,
    durationMs: 100,
  };
}

describe('browser benchmark', () => {
  it('reproduces the published sample summary from its individual records', async () => {
    const base = new URL(
      '../benchmarks/browser-evidence/sample/',
      import.meta.url,
    );
    const records = parseResults(
      await readFile(new URL('results.jsonl', base), 'utf8'),
    );
    const published = await readFile(new URL('summary.md', base), 'utf8');
    expect(summarize(records)).toBe(published);
  });
  it('serves immutable initial data and deterministic HTTP failure', async () => {
    const fixture = await startProfileFixture();
    try {
      const page = await (await fetch(fixture.url)).text();
      expect(page).toContain('value="Jane Developer"');
      expect(page).toContain('value="jane@example.test"');
      const response = await fetch(new URL('/api/profile', fixture.url), {
        method: 'POST',
        body: JSON.stringify({ name: 'Ratatoskr Test' }),
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: 'INTERNAL_ERROR',
        message: 'Unable to persist profile',
      });
      expect(await (await fetch(fixture.url)).text()).toBe(page);
      expect(
        fixture.requests.filter((request) => request.method === 'POST'),
      ).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });
  it('calculates medians and savings safely', () => {
    expect(median([9, 1, 3])).toBe(3);
    expect(median([8, 2, 4, 6])).toBe(5);
    expect(median([])).toBeNull();
    expect(savings(100, 25)).toBe(75);
    expect(savings(0, 25)).toBeNull();
    expect(savings(null, 25)).toBeNull();
    expect(savings(20, 30)).toBe(-50);
  });
  it('sums every provider turn and refuses incomplete usage', () => {
    expect(
      cumulativeUsage([
        { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
        { input_tokens: 210, output_tokens: 20, total_tokens: 230 },
      ]),
    ).toEqual({ inputTokens: 310, outputTokens: 30, totalTokens: 340 });
    expect(cumulativeUsage([null])).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    expect(cumulativeUsage([]).totalTokens).toBeNull();
  });
  it('rejects malformed and missing results', () => {
    expect(() => parseResults('{"mode":"baseline"}')).toThrow('line 1');
    expect(() => parseResults('not JSON')).toThrow('line 1');
    expect(() => summarize([])).toThrow('No benchmark results');
    expect(() => summarize([result('baseline', 1, 100)])).toThrow('Both modes');
    expect(() =>
      summarize([
        result('baseline', 1, 100),
        { ...result('ratatoskr', 1, 50), model: 'other' },
      ]),
    ).toThrow('Mixed configurations');
    expect(() =>
      summarize([result('baseline', 1, 100), result('ratatoskr', 2, 50)]),
    ).toThrow('Paired run');
    expect(() =>
      summarize([
        result('baseline', 1, 100),
        result('baseline', 1, 100),
        result('ratatoskr', 1, 50),
      ]),
    ).toThrow('Duplicate');
    expect(() =>
      parseResults(
        JSON.stringify({ ...result('baseline', 1, 100), totalTokens: 99 }),
      ),
    ).toThrow('line 1');
  });
  it('aggregates medians without selecting best runs or omitting missing usage', () => {
    const rows = [
      result('baseline', 1, 100),
      result('baseline', 2, 300),
      result('ratatoskr', 1, 40),
      result('ratatoskr', 2, 60),
    ];
    expect(summarize(rows)).toContain(
      '| Median total tokens | 200 | 50 | 75% reduction |',
    );
    rows[3] = result('ratatoskr', 2, null);
    expect(summarize(rows)).toContain(
      '| Median total tokens | 200 | N/A | — |',
    );
  });
});
