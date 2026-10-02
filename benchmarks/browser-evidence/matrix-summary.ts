import { readFile, writeFile } from 'node:fs/promises';
import { median, parseResults, type BenchmarkResult } from './metrics.js';

export function distribution(values: number[]) {
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    median: median(values)!,
    min: Math.min(...values),
    max: Math.max(...values),
    mean,
    standardDeviation: Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        values.length,
    ),
  };
}
export function summarizeMatrix(rows: BenchmarkResult[]) {
  if (!rows.length) throw new Error('No matrix results');
  if (
    new Set(
      rows.map(
        (row) =>
          `${row.suiteId}:${row.configurationHash}:${row.gitCommit}:${row.model}:${row.browserVersion}:${row.codexVersion}:${row.tokenSource}`,
      ),
    ).size !== 1
  )
    throw new Error('Mixed matrix configuration/accounting');
  if (
    new Set(
      rows.map(
        (row) => `${row.scenario}:${row.baselineId}:${row.mode}:${row.run}`,
      ),
    ).size !== rows.length
  )
    throw new Error('Duplicate matrix rows');
  const format = (value: number) =>
    value.toLocaleString('en-US', { maximumFractionDigits: 1 });
  let text = `# Token-first workflow matrix\n\nCodex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: ${rows[0]!.model}, ${rows[0]!.codexVersion}; browser ${rows[0]!.browserVersion}; execution commit ${rows[0]!.gitCommit}; started ${rows[0]!.timestamp}.\n\n| Scenario | Planned steps | Baseline | Mode | Runs | Median total tokens | Min–max | Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |\n| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
  const comparisons = [];
  for (const key of [
    ...new Set(rows.map((row) => `${row.scenario}:${row.baselineId}`)),
  ]) {
    const group = rows.filter(
      (row) => `${row.scenario}:${row.baselineId}` === key,
    );
    const direct = group.filter((row) => row.mode === 'baseline'),
      rat = group.filter((row) => row.mode === 'ratatoskr');
    if (
      !direct.length ||
      direct.length !== rat.length ||
      direct.some((row) => !rat.some((other) => other.run === row.run))
    )
      throw new Error('Unpaired matrix runs');
    for (const modeRows of [direct, rat]) {
      const tokens = modeRows.every(
        (row) => row.tokenAuthoritative && row.totalTokens !== null,
      )
        ? distribution(modeRows.map((row) => row.totalTokens!))
        : null;
      text += `| ${modeRows[0]!.scenario} | ${modeRows[0]!.plannedSteps} | ${modeRows[0]!.baselineId} | ${modeRows[0]!.mode} | ${modeRows.length} | ${tokens ? format(tokens.median) : 'N/A'} | ${tokens ? `${format(tokens.min)}–${format(tokens.max)}` : 'N/A'} | ${tokens ? `${format(tokens.mean)} ± ${format(tokens.standardDeviation)}` : 'N/A'} | ${format(median(modeRows.map((row) => row.toolInteractions))!)} | ${modeRows.reduce((sum, row) => sum + (row.invalidToolCalls ?? 0), 0)} | ${modeRows.filter((row) => row.success).length}/${modeRows.length} | ${modeRows.filter((row) => row.diagnosisCorrect).length}/${modeRows.length} |\n`;
    }
    const a = direct.every(
      (row) => row.tokenAuthoritative && row.totalTokens !== null,
    )
      ? median(direct.map((row) => row.totalTokens!))
      : null;
    const b = rat.every(
      (row) => row.tokenAuthoritative && row.totalTokens !== null,
    )
      ? median(rat.map((row) => row.totalTokens!))
      : null;
    comparisons.push({
      scenario: direct[0]!.scenario,
      baseline: direct[0]!.baselineId,
      directMedian: a,
      ratatoskrMedian: b,
      difference: a === null || b === null ? null : b - a,
      percentageChange:
        a === null || a === 0 || b === null ? null : ((b - a) / a) * 100,
    });
  }
  text +=
    '\nNegative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.\n\n| Scenario | Baseline | Token difference (Rat − direct) | Percentage change |\n| --- | --- | ---: | ---: |\n';
  for (const item of comparisons)
    text += `| ${item.scenario} | ${item.baseline} | ${item.difference === null ? 'N/A' : format(item.difference)} | ${item.percentageChange === null ? 'N/A' : format(item.percentageChange) + '%'} |\n`;
  return text;
}
if (
  process.argv[1]?.endsWith('matrix-summary.js') ||
  process.argv[1]?.endsWith('matrix-summary.ts')
) {
  const file = process.argv[2];
  if (!file) throw new Error('Pass results.jsonl');
  const summary = summarizeMatrix(parseResults(await readFile(file, 'utf8')));
  if (process.argv[3]) await writeFile(process.argv[3], summary);
  process.stdout.write(summary);
}
