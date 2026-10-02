import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { z } from 'zod';
import { runCodex } from './codex.js';
import { measureCodexTools } from './codex-observations.js';
import { observedFailure } from './agent.js';
import { parseResults, type BenchmarkResult } from './metrics.js';
import {
  startSettingsFixture,
  settingsTask,
  sizes,
  outcomes,
  type SettingsScenario,
} from './settings-fixture.js';
import { summarizeMatrix } from './matrix-summary.js';

const runs = z.coerce
  .number()
  .int()
  .min(1)
  .max(50)
  .parse(process.env.BENCHMARK_RUNS ?? 10);
const concurrency = z.coerce
  .number()
  .int()
  .min(1)
  .max(2)
  .parse(process.env.BENCHMARK_CONCURRENCY ?? 1);
const model = z.string().min(1).parse(process.env.BENCHMARK_MODEL);
const reasoning = z
  .enum(['low', 'medium', 'high'])
  .parse(process.env.BENCHMARK_CODEX_REASONING_EFFORT ?? 'medium');
const scenarios = (
  process.env.BENCHMARK_SCENARIOS ??
  'tiny-http_failure,small-http_failure,medium-http_failure,large-http_failure,medium-success,large-success,medium-locator_failure'
)
  .split(',')
  .map((value) => {
    const [size, outcome] = value.split('-');
    return {
      size: z.enum(Object.keys(sizes) as Array<keyof typeof sizes>).parse(size),
      outcome: z.enum(outcomes).parse(outcome),
    };
  });
const baselines = (process.env.BENCHMARK_BASELINES ?? 'playwright')
  .split(',')
  .map((value) => z.enum(['direct', 'playwright']).parse(value));
const suite = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .parse(process.env.BENCHMARK_SUITE ?? randomUUID());
const root = resolve('benchmarks/browser-evidence/results', suite);
await mkdir(root, { recursive: false });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const codexVersion = execFileSync('codex', ['--version'], {
  encoding: 'utf8',
}).trim();
const probe = await chromium.launch({ headless: true });
const browserVersion = probe.version();
await probe.close();
const configuration = {
  runs,
  concurrency,
  model,
  reasoning,
  scenarios,
  baselines,
  commit,
  codexVersion,
  browserVersion,
  timeoutMs: 180000,
  maxToolCalls: 24,
  viewport: { width: 1280, height: 720 },
  dirty: Boolean(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  ),
  lockfileHash: createHash('sha256')
    .update(await readFile('package-lock.json'))
    .digest('hex'),
  nodeVersion: process.version,
  tokenAccounting: 'codex-json-events',
  standardBaselineVersion: '@playwright/mcp@0.0.83',
};
const hash = createHash('sha256')
  .update(JSON.stringify(configuration))
  .digest('hex');
await writeFile(
  join(root, 'configuration.json'),
  JSON.stringify(configuration, null, 2),
);
const rows: BenchmarkResult[] = [];

async function task(
  scenario: SettingsScenario,
  baselineId: 'direct' | 'playwright',
  mode: 'baseline' | 'ratatoskr',
  run: number,
) {
  const name = `${scenario.size}-${scenario.outcome}`;
  const directory = join(root, `${name}-${baselineId}-${mode}-${run}`);
  await mkdir(directory);
  const fixture = await startSettingsFixture(scenario);
  const task = settingsTask(scenario);
  const started = Date.now();
  const signal = new AbortController();
  const timer = setTimeout(() => signal.abort(), 180000);
  try {
    const native = await runCodex({
      mode,
      url: fixture.url,
      directory,
      prompt: task.prompt,
      sourceContext: task.sourceContext,
      values: task.values,
      baseline: baselineId,
      model,
      signal: signal.signal,
      reasoningEffort: reasoning,
    });
    const tools = measureCodexTools(native.events);
    const measurements = z
      .object({
        rawEvidenceBytes: z.number(),
        artifactBytes: z.number(),
        browserInteractions: z.number(),
        toolDefinitionsBytes: z.number(),
        schemaByTool: z.array(
          z.object({
            name: z.string(),
            inputSchemaBytes: z.number(),
            descriptionBytes: z.number(),
            definitionBytes: z.number(),
          }),
        ),
      })
      .parse(
        JSON.parse(
          await readFile(join(directory, 'codex-browser-metrics.json'), 'utf8'),
        ),
      );
    const submission = fixture.requests.find(
      (request) =>
        request.method === 'POST' &&
        request.path === '/api/profile' &&
        fixture.fields.every((field) => {
          try {
            return (
              (JSON.parse(request.body) as Record<string, string>)[field.id] ===
              field.desired
            );
          } catch {
            return false;
          }
        }),
    );
    const observed = observedFailure(
      tools.interactions.map((item) => item.reply.text),
    );
    const report = native.report;
    const reload =
      submission &&
      fixture.requests
        .slice(fixture.requests.indexOf(submission) + 1)
        .some(
          (request) => request.method === 'GET' && request.path === '/profile',
        );
    const runtimeError =
      native.error ??
      (native.events.some(
        (event) =>
          event.type === 'item.completed' &&
          ['command_execution', 'file_change', 'web_search'].includes(
            String((event.item as Record<string, unknown>)?.type),
          ),
      )
        ? 'Non-browser capability used'
        : undefined);
    const criteria = {
      opened: fixture.requests.some(
        (request) => request.method === 'GET' && request.path === '/profile',
      ),
      submittedAllValues:
        scenario.outcome === 'locator_failure'
          ? !fixture.requests.some((request) => request.method === 'POST')
          : Boolean(submission),
      verified:
        scenario.outcome === 'success'
          ? Boolean(
              reload &&
              fixture.fields.every(
                (field) => fixture.stored()[field.id] === field.desired,
              ) &&
              report?.persisted === true,
            )
          : scenario.outcome === 'http_failure'
            ? Boolean(
                report?.persisted === false &&
                report.method === 'POST' &&
                report.path === '/api/profile' &&
                observed.http?.status === 500 &&
                report.status === 500 &&
                observed.code === 'INTERNAL_ERROR' &&
                report.errorCode === 'INTERNAL_ERROR',
              )
            : Boolean(
                report?.persisted === false &&
                report.errorCode === 'LOCATOR_NOT_FOUND' &&
                (/not found|not visible|Timeout|Target|locator/i.test(
                  tools.interactions.map((item) => item.reply.text).join('\n'),
                ) ||
                  tools.interactions.some(
                    (item) =>
                      /button .Save./.test(item.reply.text) &&
                      !/button .Publish./.test(item.reply.text),
                  )),
              ),
    };
    const row: BenchmarkResult = {
      benchmarkVersion: '1',
      suiteId: suite,
      mode,
      driver: 'codex',
      run,
      timestamp: new Date(started).toISOString(),
      gitCommit: commit,
      configurationHash: hash,
      model,
      browserVersion,
      codexVersion,
      ...(native.threadId ? { codexThreadId: native.threadId } : {}),
      scenario: name,
      plannedSteps: task.plannedSteps,
      baselineId,
      success: !runtimeError && Object.values(criteria).every(Boolean),
      diagnosisCorrect: criteria.verified,
      criteria,
      modelCalls: null,
      toolInteractions: tools.interactions.length,
      invalidToolCalls: tools.invalidToolCalls,
      failedToolCalls: tools.failedToolCalls,
      toolArgumentBytes: tools.toolArgumentBytes,
      toolResultBytes: tools.toolResultBytes,
      maxToolErrorBytes: tools.maxToolErrorBytes,
      ...measurements,
      ...native.accounting,
      modelEvidenceBytes: tools.toolResultBytes,
      returnedEvidenceBytes: tools.toolResultBytes,
      cumulativeContextEvidenceBytes: null,
      durationMs: Date.now() - started,
      ...(runtimeError ? { error: runtimeError } : {}),
    };
    await writeFile(
      join(directory, 'fixture-audit.json'),
      JSON.stringify(fixture.requests, null, 2),
    );
    await writeFile(
      join(directory, 'model-visible-tools.json'),
      JSON.stringify(tools, null, 2),
    );
    await writeFile(
      join(directory, 'report.json'),
      JSON.stringify({ report: report ?? null, result: row }, null, 2),
    );
    await writeFile(
      join(directory, 'task.json'),
      JSON.stringify(task, null, 2),
    );
    await appendFile(join(root, 'results.jsonl'), JSON.stringify(row) + '\n');
    rows.push(row);
    process.stdout.write(JSON.stringify(row) + '\n');
  } finally {
    clearTimeout(timer);
    await fixture.close();
  }
}
const pairs: Array<() => Promise<void>> = [];
for (const scenario of scenarios)
  for (const baseline of baselines)
    for (let run = 1; run <= runs; run++)
      pairs.push(async () => {
        for (const mode of run % 2
          ? (['baseline', 'ratatoskr'] as const)
          : (['ratatoskr', 'baseline'] as const))
          await task(scenario, baseline, mode, run);
      });
for (let index = 0; index < pairs.length; index += concurrency)
  await Promise.all(
    pairs.slice(index, index + concurrency).map((pair) => pair()),
  );
const summary = summarizeMatrix(
  parseResults(await readFile(join(root, 'results.jsonl'), 'utf8')),
);
await writeFile(join(root, 'summary.md'), summary);
process.stdout.write(summary + `\nResults: ${root}\n`);
if (rows.some((row) => !row.success)) process.exitCode = 1;
