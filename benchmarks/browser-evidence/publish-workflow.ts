import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseResults, type BenchmarkResult } from './metrics.js';
import { codexAccounting } from './usage.js';
import { measureCodexTools } from './codex-observations.js';
import { summarizeMatrix, distribution } from './matrix-summary.js';

/** Keep only native lifecycle counts, never tool bodies, thread IDs or error text. */
export function nativeCounts(events: Array<Record<string, unknown>>) {
  return events
    .filter((event) =>
      [
        'thread.started',
        'turn.started',
        'turn.completed',
        'turn.failed',
      ].includes(String(event.type)),
    )
    .map((event) => ({
      type: event.type,
      ...(event.type === 'turn.completed'
        ? {
            usage:
              event.usage && typeof event.usage === 'object'
                ? Object.fromEntries(
                    Object.entries(event.usage).filter(
                      ([key, value]) =>
                        [
                          'input_tokens',
                          'cached_input_tokens',
                          'output_tokens',
                          'reasoning_output_tokens',
                          'total_tokens',
                        ].includes(key) && typeof value === 'number',
                    ),
                  )
                : null,
          }
        : {}),
    }));
}

export function verifyWorkflowCounts(
  row: BenchmarkResult,
  events: Array<Record<string, unknown>>,
) {
  const accounting = codexAccounting(events);
  for (const key of Object.keys(accounting) as Array<keyof typeof accounting>)
    if (accounting[key] !== row[key])
      throw new Error(
        `Native usage mismatch: ${row.scenario}/${row.mode}/${row.run}/${key}`,
      );
  const tools = measureCodexTools(events);
  for (const key of [
    'invalidToolCalls',
    'failedToolCalls',
    'toolArgumentBytes',
    'toolResultBytes',
    'maxToolErrorBytes',
  ] as const)
    if (tools[key] !== row[key])
      throw new Error(`Native tool counts mismatch: ${key}`);
  if (tools.interactions.length !== row.toolInteractions)
    throw new Error('Native MCP call count mismatch');
  return tools;
}

async function publish(root: string, label: string, legacy: boolean) {
  if (!/^[A-Za-z0-9_-]+$/.test(label))
    throw new Error('Invalid publication label');
  const rows = parseResults(
    await readFile(join(root, 'results.jsonl'), 'utf8'),
  );
  const usage = [],
    calls = [];
  for (const row of rows) {
    const directory = join(
      root,
      legacy
        ? `${row.scenario}-${row.baselineId}-${row.mode}-${row.run}`
        : `${row.scenario}-${row.mode}-${row.run}`,
    );
    const events = (
      await readFile(join(directory, 'codex-events.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const tools = verifyWorkflowCounts(row, events);
    const key = { scenario: row.scenario, mode: row.mode, run: row.run };
    usage.push({ ...key, events: nativeCounts(events) });
    calls.push({
      ...key,
      workflow: tools.interactions.filter(
        (item) => item.name === 'run_browser_workflow',
      ).length,
      inspection: tools.interactions.filter(
        (item) => item.name === 'inspect_browser_run',
      ).length,
      artifact: tools.interactions.filter(
        (item) => item.name === 'get_browser_artifact',
      ).length,
      direct: tools.interactions.filter((item) =>
        item.name.startsWith('browser_'),
      ).length,
      workflowDurationMs: null as number | null,
    });
    const metrics = JSON.parse(
      await readFile(join(directory, 'codex-browser-metrics.json'), 'utf8'),
    ) as Record<string, unknown>;
    if (typeof metrics.workflowDurationMs === 'number')
      calls.at(-1)!.workflowDurationMs = metrics.workflowDurationMs;
  }
  const groups = [
    ...new Set(rows.map((row) => `${row.scenario}/${row.mode}`)),
  ].map((key) => {
    const group = rows.filter((row) => `${row.scenario}/${row.mode}` === key);
    return {
      key,
      metrics: Object.fromEntries(
        [
          'inputTokens',
          'cachedInputTokens',
          'uncachedInputTokens',
          'outputTokens',
          'reasoningTokens',
          'totalTokens',
          'toolInteractions',
          'invalidToolCalls',
          'browserInteractions',
          'toolArgumentBytes',
          'toolResultBytes',
          'durationMs',
        ].map((metric) => [
          metric,
          distribution(
            group
              .map((row) => row[metric as keyof BenchmarkResult])
              .filter((value): value is number => typeof value === 'number'),
          ),
        ]),
      ),
    };
  });
  const destination = join(
    'benchmarks/browser-evidence/workflow-intelligence',
    label,
  );
  await mkdir(destination, { recursive: true });
  const jsonl = (items: unknown[]) =>
    items.map((item) => JSON.stringify(item)).join('\n') + '\n';
  await writeFile(
    join(destination, 'results.jsonl'),
    jsonl(
      rows.map((row) => {
        const safe = { ...row };
        delete safe.codexThreadId;
        return safe;
      }),
    ),
  );
  await writeFile(join(destination, 'native-usage.jsonl'), jsonl(usage));
  await writeFile(join(destination, 'calls.jsonl'), jsonl(calls));
  await writeFile(
    join(destination, 'distributions.json'),
    JSON.stringify(groups, null, 2) + '\n',
  );
  await writeFile(
    join(destination, 'configuration.json'),
    await readFile(join(root, 'configuration.json')),
  );
  await writeFile(
    join(destination, 'summary.md'),
    summarizeMatrix(rows).replaceAll(
      '| Metric | Direct browser | Ratatoskr |',
      '| Metric | Baseline | Ratatoskr |',
    ) +
      (legacy
        ? ''
        : '\nGenerated compares manual versus CLI-derived plans using Ratatoskr in both modes. Other baselines use official Playwright MCP.\n'),
  );
  process.stdout.write(
    `Published ${rows.length} verified count records: ${destination}\n`,
  );
}

if (
  process.argv[1]?.endsWith('publish-workflow.ts') ||
  process.argv[1]?.endsWith('publish-workflow.js')
) {
  const root = process.argv[2],
    label = process.argv[3];
  if (!root || !label)
    throw new Error(
      'Pass raw suite directory, publication label and optional --legacy',
    );
  await publish(root, label, process.argv.includes('--legacy'));
}
