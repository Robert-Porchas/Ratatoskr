import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { z } from 'zod';
import {
  createSessionFixture,
  authScenarios,
  type AuthScenario,
} from '../../test/fixture/session.js';
import { runCodex } from './codex.js';
import { measureCodexTools } from './codex-observations.js';
import { parseResults } from './metrics.js';
import { unavailableUsage } from './usage.js';
import {
  SessionCaseSchema,
  SessionResultSchema,
  gradeSession,
  sessionTask,
  summarizeSessions,
  type SessionBenchmarkResult,
} from './session-contract.js';

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
  process.env.BENCHMARK_SESSION_SCENARIOS ?? authScenarios.join(',')
)
  .split(',')
  .map((value) => z.enum(authScenarios).parse(value));
const cases = (process.env.BENCHMARK_SESSION_CASES ?? 'without,with,direct')
  .split(',')
  .map((value) => SessionCaseSchema.parse(value));
const directScenarios = (
  process.env.BENCHMARK_SESSION_DIRECT_SCENARIOS ?? 'missing,scope'
)
  .split(',')
  .map((value) => z.enum(authScenarios).parse(value));
const suite = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .parse(process.env.BENCHMARK_SUITE ?? `session-${randomUUID()}`);
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
  cases,
  directScenarios,
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
  baseline:
    '@playwright/mcp@0.0.83 core + read-only cookie/localStorage/sessionStorage lists + request detail (21 tools)',
  comparison:
    'without disables automatic Level 1 only; same observer, safe persistence, Level 2 and MCP definitions',
  taskContracts: Object.fromEntries(
    scenarios.map((scenario) => [scenario, sessionTask(scenario)]),
  ),
};
const hash = createHash('sha256')
  .update(JSON.stringify(configuration))
  .digest('hex');
await writeFile(
  join(root, 'configuration.json'),
  JSON.stringify(configuration, null, 2),
);
const rows: SessionBenchmarkResult[] = [];

async function task(
  scenario: AuthScenario,
  sessionCase: z.infer<typeof SessionCaseSchema>,
  run: number,
) {
  const directory = join(root, `${scenario}-${sessionCase}-${run}`);
  await mkdir(directory);
  const fixture = createSessionFixture();
  fixture.server.listen(0, '127.0.0.1');
  await once(fixture.server, 'listening');
  const address = fixture.server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fixture did not bind');
  const url = `http://127.0.0.1:${address.port}/auth?scenario=${scenario}`;
  const contract = sessionTask(scenario);
  await writeFile(
    join(directory, 'task.json'),
    JSON.stringify(contract, null, 2),
  );
  const started = Date.now();
  const signal = new AbortController();
  const timer = setTimeout(() => signal.abort(), 180000);
  let runtimeError: string | undefined;
  let native: Awaited<ReturnType<typeof runCodex>> | undefined;
  try {
    try {
      native = await runCodex({
        mode: sessionCase === 'direct' ? 'baseline' : 'ratatoskr',
        url,
        directory,
        prompt: contract.prompt,
        sourceContext: contract.sourceContext,
        model,
        baseline: 'playwright',
        sessionDiagnostics: sessionCase === 'without' ? 'off' : 'on',
        reasoningEffort: reasoning,
        signal: signal.signal,
      });
      runtimeError = native.error;
    } catch (error) {
      runtimeError =
        error instanceof Error
          ? error.message.slice(0, 200)
          : 'Benchmark task failed';
    }
    const tools = measureCodexTools(native?.events ?? []);
    const measurement = z
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
        sessionMetrics: SessionResultSchema.shape.sessionMetrics,
        compactFailureBytes: z.number().optional(),
        workflowDurationMs: z.number().optional(),
      })
      .parse(
        JSON.parse(
          await readFile(join(directory, 'codex-browser-metrics.json'), 'utf8'),
        ),
      );
    const observed = tools.interactions
      .map((item) => JSON.stringify(item.arguments) + '\n' + item.reply.text)
      .join('\n');
    const graded = gradeSession(
      scenario,
      fixture.requests,
      native?.report,
      observed,
    );
    const inspect = tools.interactions.filter((item) =>
      item.name.endsWith('inspect_browser_run'),
    );
    const sessionInspect = inspect.filter(
      (item) =>
        Array.isArray(item.arguments.include) &&
        item.arguments.include.includes('session'),
    );
    const artifact = tools.interactions.filter((item) =>
      item.name.endsWith('get_browser_artifact'),
    );
    const row = SessionResultSchema.parse({
      benchmarkVersion: '1',
      suiteId: suite,
      sessionCase,
      expectedCases: cases.filter(
        (key) => key !== 'direct' || directScenarios.includes(scenario),
      ),
      expectedRuns: runs,
      mode: sessionCase === 'direct' ? 'baseline' : 'ratatoskr',
      driver: 'codex',
      run,
      timestamp: new Date(started).toISOString(),
      gitCommit: commit,
      configurationHash: hash,
      model,
      browserVersion,
      codexVersion,
      ...(native?.threadId ? { codexThreadId: native.threadId } : {}),
      scenario,
      plannedSteps: contract.plannedSteps,
      baselineId: 'playwright',
      ...graded,
      success: !runtimeError && graded.success,
      modelCalls: null,
      toolInteractions: tools.interactions.length,
      invalidToolCalls: tools.invalidToolCalls,
      failedToolCalls: tools.failedToolCalls,
      toolArgumentBytes: tools.toolArgumentBytes,
      toolResultBytes: tools.toolResultBytes,
      maxToolErrorBytes: tools.maxToolErrorBytes,
      ...measurement,
      compactFailureBytes: measurement.compactFailureBytes ?? 0,
      workflowDurationMs: measurement.workflowDurationMs ?? 0,
      ...(native?.accounting ?? unavailableUsage('codex-json-events')),
      modelEvidenceBytes: tools.toolResultBytes,
      returnedEvidenceBytes: tools.toolResultBytes,
      cumulativeContextEvidenceBytes: null,
      sessionInspectionCalls: sessionInspect.length,
      sessionInspectionBytes: sessionInspect.reduce((sum, item) => {
        try {
          const value = z
            .object({
              structuredContent: z.object({
                sections: z.object({ session: z.unknown().optional() }),
              }),
            })
            .parse(JSON.parse(item.reply.text));
          return (
            sum +
            (value.structuredContent.sections.session
              ? Buffer.byteLength(
                  JSON.stringify(value.structuredContent.sections.session),
                )
              : 0)
          );
        } catch {
          return sum;
        }
      }, 0),
      sessionArtifactRequests: artifact.filter((item) =>
        item.reply.text.includes('browser_storage_state'),
      ).length,
      inspectCalls: inspect.length,
      artifactCalls: artifact.length,
      durationMs: Date.now() - started,
      ...(runtimeError ? { error: runtimeError } : {}),
    });
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
      JSON.stringify({ report: native?.report ?? null, result: row }, null, 2),
    );
    await appendFile(join(root, 'results.jsonl'), JSON.stringify(row) + '\n');
    rows.push(row);
    process.stdout.write(JSON.stringify(row) + '\n');
  } finally {
    clearTimeout(timer);
    fixture.server.closeAllConnections();
    await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  }
}
const jobs: Array<() => Promise<void>> = [];
for (const scenario of scenarios)
  for (let run = 1; run <= runs; run++)
    jobs.push(async () => {
      const selected = cases.filter(
        (key) => key !== 'direct' || directScenarios.includes(scenario),
      );
      if (!selected.length)
        throw new Error('No benchmark cases selected for scenario');
      const rotation = run % selected.length;
      for (const key of [
        ...selected.slice(rotation),
        ...selected.slice(0, rotation),
      ])
        await task(scenario, key, run);
    });
for (let index = 0; index < jobs.length; index += concurrency)
  await Promise.all(jobs.slice(index, index + concurrency).map((job) => job()));
const raw = await readFile(join(root, 'results.jsonl'), 'utf8');
parseResults(raw); // Existing authoritative accounting validation remains in force.
const summary = summarizeSessions(
  raw
    .trim()
    .split('\n')
    .map((line) => SessionResultSchema.parse(JSON.parse(line))),
);
await writeFile(join(root, 'summary.md'), summary);
process.stdout.write(summary + `\nResults: ${root}\n`);
if (rows.some((row) => !row.success)) process.exitCode = 1;
