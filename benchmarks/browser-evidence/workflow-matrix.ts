import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { z } from 'zod';
import {
  startWorkflowFixture,
  workflowPlan,
  type WorkflowScenario,
} from '../../test/fixture/workflow.js';
import { deriveWorkflows } from '../../src/derive-workflow.js';
import { flattenSteps } from '../../src/workflow-structure.js';
import { normalizeWirePlan } from '../../src/mcp/wire-plan.js';
import { runCodex } from './codex.js';
import { measureCodexTools } from './codex-observations.js';
import { summarizeMatrix, distribution } from './matrix-summary.js';
import { type BenchmarkResult, parseResults } from './metrics.js';

const scenarioSchema = z.enum([
  'variables',
  'login-required',
  'login-existing',
  'transient',
  'server-failure',
  'generated',
  'complex',
]);
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
const maxToolCalls = z.coerce
  .number()
  .int()
  .min(1)
  .max(60)
  .parse(process.env.BENCHMARK_MAX_TOOL_CALLS ?? 24);
const scenarios = (
  process.env.BENCHMARK_WORKFLOWS ?? scenarioSchema.options.join(',')
)
  .split(',')
  .map((value) => scenarioSchema.parse(value));
const suite = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/)
  .parse(process.env.BENCHMARK_SUITE ?? randomUUID());
const root = resolve('benchmarks/browser-evidence/results', suite);
await mkdir(resolve('benchmarks/browser-evidence/results'), {
  recursive: true,
});
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
const source = await readFile('examples/project.spec.ts', 'utf8');
const configuration = {
  runs,
  concurrency,
  model,
  reasoning,
  scenarios,
  commit,
  codexVersion,
  browserVersion,
  dirty: Boolean(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  ),
  nodeVersion: process.version,
  lockfileHash: createHash('sha256')
    .update(await readFile('package-lock.json'))
    .digest('hex'),
  timeoutMs: 180000,
  maxToolCalls,
  proxyMaxToolCalls: maxToolCalls,
  viewport: { width: 1280, height: 720 },
  tokenAccounting: 'codex-json-events',
  baseline: '@playwright/mcp@0.0.83',
  generatedComparison:
    'manual translation vs CLI-derived plan; both use actual Ratatoskr MCP',
  fixtureHash: createHash('sha256')
    .update(await readFile('test/fixture/workflow.ts'))
    .digest('hex'),
  sourceHash: createHash('sha256').update(source).digest('hex'),
};
const hash = createHash('sha256')
  .update(JSON.stringify(configuration))
  .digest('hex');
await writeFile(
  join(root, 'configuration.json'),
  JSON.stringify(configuration, null, 2),
);
const rows: BenchmarkResult[] = [];

function task(scenario: WorkflowScenario, base: string, generated: boolean) {
  const common = `Source facts: routes /entry, /projects/<id>, /gate. Projects heading has testId dashboard. Form label Project name; button Create project. POST /api/projects stores name and returns generated ID P-<sequence>, rendered at testId project-id. Project page testId project-name reads stored name; Description field and Save details POST /api/projects/<id> store description; page reloads on success and testId description reads stored data. Desired project name Ratatoskr Test is valueRef BENCHMARK_NAME. Login labels Email and Password use local BENCHMARK_FIELD_1 and BENCHMARK_FIELD_2 (direct tools: fixture@example.test and fixture-password). Sign in POST /api/login sets a cookie and reloads /entry. Use UI assertions, never execute JS. Do not repeat mutations to investigate a failure. Report persisted true and status 200 for a verified success; otherwise persisted false and the observed status/code. Use method/path of the relevant POST, or GET for read-only tasks.`;
  const prompts: Record<WorkflowScenario, string> = {
    variables:
      'Create one project, read its generated ID, open /projects/<that ID>, and verify the stored project name. Report POST /api/projects.',
    'login-required':
      'Open /entry. The user may need login: continue when dashboard is visible, otherwise sign in. Verify dashboard. Report POST /api/login if login occurs, otherwise GET /entry.',
    'login-existing':
      'Open /entry. The user may need login: continue when dashboard is visible, otherwise sign in. Verify dashboard. Report POST /api/login if login occurs, otherwise GET /entry.',
    transient:
      'Open /gate and wait for testId ready with text Ready. A known transient fixture state can require one reload: recover locally where supported and verify Ready. Report GET /gate. The first visit lacks ready; the second visit renders it.',
    'server-failure':
      'Attempt to create one project and verify the ID. Diagnose any application failure using compact evidence first. Report POST /api/projects and INTERNAL_ERROR on the deterministic HTTP 500. Do not resubmit.',
    generated:
      'Execute the browser behavior specified by the existing Playwright test. Verify the generated project ID. Report POST /api/projects.',
    complex:
      'Handle optional login, create one project, extract its generated ID, open that project, verify stored name, wait for testId ready, set Description to Project <generated ID>, save once, reopen the project and verify stored Description. First project visit lacks ready; one reload reveals it. Report POST /api/projects/<generated ID>. Prefer one complete workflow if the tools support local variables, branches and recovery.',
  };
  return {
    prompt: prompts[scenario],
    sourceContext:
      common +
      (scenario === 'generated'
        ? generated
          ? ` Deterministic CLI derive-workflow output (validated): ${JSON.stringify(deriveWorkflows(source, 'examples/project.spec.ts', base))}`
          : ` Existing Playwright test to translate: ${source}`
        : ''),
    values: {
      BENCHMARK_NAME: 'Ratatoskr Test',
      BENCHMARK_FIELD_1: 'fixture@example.test',
      BENCHMARK_FIELD_2: 'fixture-password',
    },
  };
}

async function run(
  scenario: WorkflowScenario,
  mode: 'baseline' | 'ratatoskr',
  run: number,
) {
  const directory = join(root, `${scenario}-${mode}-${run}`);
  await mkdir(directory);
  const fixture = await startWorkflowFixture(scenario);
  const details = task(scenario, fixture.base, mode === 'ratatoskr');
  const started = Date.now(),
    controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const native = await runCodex({
      mode,
      url: fixture.url,
      directory,
      ...details,
      baseline: 'playwright',
      model,
      signal: controller.signal,
      reasoningEffort: reasoning,
      workflowScope: true,
      maxToolCalls,
      ...(scenario === 'generated' ? { toolMode: 'ratatoskr' as const } : {}),
    });
    const tools = measureCodexTools(native.events);
    const metrics = z
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
        workflowDurationMs: z.number().optional(),
      })
      .parse(
        JSON.parse(
          await readFile(join(directory, 'codex-browser-metrics.json'), 'utf8'),
        ),
      );
    const reports = tools.interactions
      .map((item) => item.reply.text)
      .join('\n');
    const created = fixture.requests.filter(
      (request) =>
        request.method === 'POST' && request.path === '/api/projects',
    );
    const expectedLogin =
      scenario === 'login-required' || scenario === 'complex';
    const criteria = {
      opened: fixture.requests.some(
        (request) =>
          request.method === 'GET' &&
          request.path === (scenario === 'transient' ? '/gate' : '/entry'),
      ),
      mutationCount: scenario.startsWith('login-')
        ? fixture.loginCount() === (expectedLogin ? 1 : 0)
        : scenario === 'transient'
          ? created.length === 0
          : created.length === 1,
      detailsCount:
        scenario !== 'complex' ||
        fixture.requests.filter(
          (request) =>
            request.method === 'POST' && request.path === '/api/projects/P-1',
        ).length === 1,
      persisted:
        scenario === 'server-failure'
          ? fixture.projects.size === 0
          : scenario.startsWith('login-')
            ? fixture.loginCount() === (expectedLogin ? 1 : 0)
            : scenario === 'transient'
              ? fixture.gateVisits() === 2
              : fixture.projects.size === 1 &&
                fixture.projects.get('P-1')?.name === 'Ratatoskr Test',
      continued:
        scenario === 'variables' || scenario === 'complex'
          ? fixture.requests.some(
              (request) =>
                request.path === '/projects/P-1' && request.method === 'GET',
            )
          : true,
      recovered:
        scenario === 'transient'
          ? fixture.gateVisits() === 2
          : scenario === 'complex'
            ? fixture.gateVisits() >= 3 &&
              fixture.projects.get('P-1')?.description === 'Project P-1'
            : true,
      verified:
        scenario === 'server-failure'
          ? native.report?.persisted === false &&
            native.report.status === 500 &&
            native.report.errorCode === 'INTERNAL_ERROR' &&
            /500/.test(reports) &&
            /INTERNAL_ERROR/.test(reports)
          : native.report?.persisted === true && native.report.status === 200,
      diagnosisPath:
        native.report?.method ===
          (scenario === 'transient' || scenario === 'login-existing'
            ? 'GET'
            : 'POST') &&
        native.report.path ===
          (scenario === 'transient'
            ? '/gate'
            : scenario === 'login-existing'
              ? '/entry'
              : scenario === 'login-required'
                ? '/api/login'
                : scenario === 'complex'
                  ? '/api/projects/P-1'
                  : '/api/projects'),
      browserOnly: !native.events.some(
        (event) =>
          event.type === 'item.completed' &&
          ['command_execution', 'file_change', 'web_search'].includes(
            String((event.item as Record<string, unknown>)?.type),
          ),
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
      scenario,
      baselineId: scenario === 'generated' ? 'direct' : 'playwright',
      plannedSteps: flattenSteps(
        normalizeWirePlan(workflowPlan(scenario, fixture.base)).steps,
      ).length,
      success: !native.error && Object.values(criteria).every(Boolean),
      diagnosisCorrect: criteria.verified && criteria.diagnosisPath,
      criteria,
      modelCalls: null,
      toolInteractions: tools.interactions.length,
      invalidToolCalls: tools.invalidToolCalls,
      failedToolCalls: tools.failedToolCalls,
      toolArgumentBytes: tools.toolArgumentBytes,
      toolResultBytes: tools.toolResultBytes,
      maxToolErrorBytes: tools.maxToolErrorBytes,
      ...metrics,
      ...native.accounting,
      modelEvidenceBytes: tools.toolResultBytes,
      returnedEvidenceBytes: tools.toolResultBytes,
      cumulativeContextEvidenceBytes: null,
      durationMs: Date.now() - started,
      ...(native.error ? { error: native.error } : {}),
    };
    const calls = {
      workflow: tools.interactions.filter(
        (item) => item.name === 'run_browser_workflow',
      ).length,
      inspection: tools.interactions.filter(
        (item) => item.name === 'inspect_browser_run',
      ).length,
      direct: tools.interactions.filter((item) =>
        item.name.startsWith('browser_'),
      ).length,
    };
    await writeFile(
      join(directory, 'fixture-audit.json'),
      JSON.stringify(fixture.requests, null, 2),
    );
    await writeFile(
      join(directory, 'report.json'),
      JSON.stringify(
        { report: native.report ?? null, result: row, calls },
        null,
        2,
      ),
    );
    await writeFile(
      join(directory, 'task.json'),
      JSON.stringify(details, null, 2),
    );
    await writeFile(
      join(directory, 'model-visible-tools.json'),
      JSON.stringify(tools, null, 2),
    );
    await appendFile(join(root, 'results.jsonl'), JSON.stringify(row) + '\n');
    rows.push(row);
    await appendFile(
      join(root, 'calls.jsonl'),
      JSON.stringify({
        scenario,
        mode,
        run,
        ...calls,
        workflowDurationMs: metrics.workflowDurationMs ?? null,
      }) + '\n',
    );
    process.stdout.write(
      JSON.stringify({
        scenario,
        mode,
        run,
        success: row.success,
        totalTokens: row.totalTokens,
        calls,
      }) + '\n',
    );
  } finally {
    clearTimeout(timer);
    await fixture.close();
  }
}
const jobs = scenarios.flatMap((scenario) =>
  Array.from({ length: runs }, (_, index) => async () => {
    for (const mode of index % 2
      ? (['ratatoskr', 'baseline'] as const)
      : (['baseline', 'ratatoskr'] as const))
      await run(scenario, mode, index + 1);
  }),
);
for (let index = 0; index < jobs.length; index += concurrency)
  await Promise.all(jobs.slice(index, index + concurrency).map((job) => job()));
await writeFile(
  join(root, 'summary.md'),
  summarizeMatrix(
    parseResults(await readFile(join(root, 'results.jsonl'), 'utf8')),
  ).replace(
    '| Metric | Direct browser | Ratatoskr |',
    '| Metric | Baseline | Ratatoskr |',
  ) +
    '\nGenerated compares manual translation with CLI-derived plans using Ratatoskr in both modes; its baseline is not direct browser tooling. All other baselines use official Playwright MCP.\n',
);
const distributions = scenarios.flatMap((scenario) =>
  ['baseline', 'ratatoskr'].map((mode) => ({
    scenario,
    mode,
    metrics: Object.fromEntries(
      [
        'inputTokens',
        'cachedInputTokens',
        'uncachedInputTokens',
        'outputTokens',
        'reasoningTokens',
        'totalTokens',
        'toolInteractions',
        'browserInteractions',
        'toolArgumentBytes',
        'toolResultBytes',
        'durationMs',
      ].map((key) => [
        key,
        distribution(
          rows
            .filter((row) => row.scenario === scenario && row.mode === mode)
            .map((row) => row[key as keyof BenchmarkResult])
            .filter((value): value is number => typeof value === 'number'),
        ),
      ]),
    ),
  })),
);
await writeFile(
  join(root, 'distributions.json'),
  JSON.stringify(distributions, null, 2),
);
process.stdout.write(`Results: ${root}\n`);
if (rows.some((row) => !row.success)) process.exitCode = 1;
