import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { parseResults, ReportSchema, type BenchmarkResult } from './metrics.js';
import { codexAccounting } from './usage.js';
import { measureCodexTools } from './codex-observations.js';
import { summarizeMatrix } from './matrix-summary.js';

/** Reproducible post-hoc counter audit. Never rewrites original evidence or provider usage. */
export async function auditMatrix(root: string): Promise<BenchmarkResult[]> {
  const rows = parseResults(
    await readFile(join(root, 'results.jsonl'), 'utf8'),
  );
  const audited: BenchmarkResult[] = [];
  for (const row of rows) {
    if (!row.scenario || !row.baselineId || row.driver !== 'codex')
      throw new Error('Audit requires a native Codex matrix suite');
    const directory = join(
      root,
      `${row.scenario}-${row.baselineId}-${row.mode}-${row.run}`,
    );
    const events = (
      await readFile(join(directory, 'codex-events.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
    const usage = codexAccounting(events);
    for (const key of [
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'cachedInputTokens',
      'uncachedInputTokens',
      'reasoningTokens',
    ] as const)
      if (row[key] !== usage[key])
        throw new Error(`Native usage mismatch: ${key}`);
    const measured = measureCodexTools(events);
    if (
      row.toolInteractions !== measured.interactions.length ||
      row.toolArgumentBytes !== measured.toolArgumentBytes ||
      row.toolResultBytes !== measured.toolResultBytes
    )
      throw new Error('Native interaction byte/count mismatch');
    const { report } = z
      .object({ report: ReportSchema })
      .parse(
        JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')),
      );
    const methodAndPath =
      !row.scenario.endsWith('http_failure') ||
      (report.method === 'POST' && report.path === '/api/profile');
    const withinToolBudget = measured.interactions.length <= 24;
    audited.push({
      ...row,
      invalidToolCalls: measured.invalidToolCalls,
      failedToolCalls: measured.failedToolCalls,
      criteria: { ...row.criteria, methodAndPath, withinToolBudget },
      success: row.success && methodAndPath && withinToolBudget,
      diagnosisCorrect: row.diagnosisCorrect && methodAndPath,
    });
  }
  return audited;
}

if (
  process.argv[1]?.endsWith('audit-matrix.ts') ||
  process.argv[1]?.endsWith('audit-matrix.js')
) {
  if (!process.argv[2]) throw new Error('Pass the matrix suite directory');
  const root = resolve(process.argv[2]);
  const rows = await auditMatrix(root);
  await writeFile(
    join(root, 'audited-results.jsonl'),
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    { flag: 'wx' },
  );
  await writeFile(join(root, 'audited-summary.md'), summarizeMatrix(rows), {
    flag: 'wx',
  });
  process.stdout.write(
    `Audited ${rows.length} tasks; original files and token totals unchanged.\n`,
  );
}
