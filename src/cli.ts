#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserPlanSchema,
  HttpUrlSchema,
  type BrowserPlan,
} from './protocol.js';
import { InvalidPlanError } from './errors.js';
import {
  InspectionCategorySchema,
  type InspectionCategory,
} from './inspection.js';
import { createRatatoskrApplication } from './application.js';
import { VERSION } from './version.js';
import { normalizeWirePlan } from './mcp/wire-plan.js';
import { exportWorkflow } from './export-workflow.js';
import { readBoundedFile, writeNewWorkspaceFile } from './local-files.js';
import { junitReport, runExitCode } from './reporting.js';

const help = `Ratatoskr ${VERSION}
run <workflow.json> [--report json|junit] [--artifacts directory] [--base-url URL] [--timeout milliseconds]
validate <workflow.json>
compare <baselineRunId> <candidateRunId> [--max-differences 1..50] [--timing]
export <workflow.json> [--out tests/name.spec.ts] [--name test-name] [--base-url URL]
diagnose <runId>
source <generated-url> <line> <column>
doctor [--json]
derive-workflow <test.ts> [--base-url URL]
inspect <runId> [categories]
artifact <runId> <artifactId> [--out path]
--help | --version
`;
const json = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value)}\n`);
async function planFile(path: string): Promise<BrowserPlan> {
  const input: unknown = JSON.parse(await readBoundedFile(resolve(path)));
  const parsed = BrowserPlanSchema.safeParse(
    input && typeof input === 'object' && 'url' in input
      ? normalizeWirePlan(input)
      : input,
  );
  if (!parsed.success)
    throw new InvalidPlanError(
      'Invalid workflow; validate fields against the workflow schema',
    );
  return parsed.data;
}
function flags(
  args: string[],
  valued: string[],
  switches: string[] = [],
): { positional: string[]; options: Map<string, string> } {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (options.has(arg)) throw new Error('Duplicate option');
    if (switches.includes(arg)) options.set(arg, 'true');
    else if (
      valued.includes(arg) &&
      args[index + 1] &&
      !args[index + 1]!.startsWith('--')
    )
      options.set(arg, args[++index]!);
    else throw new Error('Unknown option or missing option value; use --help');
  }
  return { positional, options };
}
async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(help);
    return;
  }
  if (command === '--version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === 'doctor') {
    const { positional, options } = flags(rest, [], ['--json']);
    if (positional.length) throw new Error('Usage: doctor [--json]');
    const { doctor } = await import('./doctor.js');
    const checks = await doctor(
      fileURLToPath(new URL('../../', import.meta.url)),
    );
    if (options.has('--json'))
      json({
        checks,
        ready: checks.every((check) => check.ok || check.optional),
      });
    else
      for (const check of checks)
        process.stdout.write(
          `${check.ok ? 'PASS' : check.optional ? 'WARN' : 'FAIL'} ${check.name}${check.detail ? `: ${check.detail}` : ''}\n`,
        );
    if (checks.some((check) => !check.ok && !check.optional))
      process.exitCode = 3;
    return;
  }
  if (command === 'run' || command === 'validate' || command === 'export') {
    const allowed =
      command === 'run'
        ? ['--report', '--artifacts', '--base-url', '--timeout']
        : command === 'export'
          ? ['--out', '--name', '--base-url']
          : [];
    const { positional, options } = flags(rest, allowed);
    if (positional.length !== 1)
      throw new Error(`Usage: ${command} <workflow.json>; use --help`);
    let plan = await planFile(positional[0]!);
    if (command === 'validate') {
      json({ valid: true });
      return;
    }
    if (command === 'export') {
      const result = exportWorkflow(plan, {
        ...(options.has('--name') ? { testName: options.get('--name')! } : {}),
        ...(options.has('--base-url')
          ? { baseURL: options.get('--base-url')! }
          : {}),
      });
      const { source, ...metadata } = result;
      if (source && options.has('--out')) {
        await writeNewWorkspaceFile(options.get('--out')!, source);
        json({ ...metadata, outputPath: resolve(options.get('--out')!) });
      } else if (source)
        json(
          await createRatatoskrApplication().export(plan, {
            ...(options.has('--name')
              ? { testName: options.get('--name')! }
              : {}),
            ...(options.has('--base-url')
              ? { baseURL: options.get('--base-url')! }
              : {}),
          }),
        );
      else json(metadata);
      if (!result.ready) process.exitCode = 2;
      return;
    }
    const report = options.get('--report') ?? 'json';
    if (!['json', 'junit'].includes(report))
      throw new Error('Report must be json or junit');
    if (options.has('--base-url')) {
      const base = new URL(HttpUrlSchema.parse(options.get('--base-url')));
      if (base.pathname !== '/' || base.search || base.hash)
        throw new Error('--base-url requires an origin');
      const origin = new URL(plan.startUrl).origin;
      const replace = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(replace);
        if (value && typeof value === 'object')
          return Object.fromEntries(
            Object.entries(value).map(([key, item]) => {
              if (
                (key === 'startUrl' || key === 'url') &&
                typeof item === 'string'
              ) {
                const url = new URL(item);
                if (url.origin === origin)
                  return [
                    key,
                    `${base.origin}${url.pathname}${url.search}${url.hash}`,
                  ];
              }
              return [key, replace(item)];
            }),
          );
        return value;
      };
      // Initial URL can be an origin with no trailing slash.
      plan = BrowserPlanSchema.parse({
        ...(replace(plan) as BrowserPlan),
        startUrl: new URL(
          new URL(plan.startUrl).pathname + new URL(plan.startUrl).search,
          base,
        ).href,
      });
    }
    if (options.has('--timeout'))
      plan = BrowserPlanSchema.parse({
        ...plan,
        timeoutMs: Number(options.get('--timeout')),
      });
    const app = createRatatoskrApplication({
      ...process.env,
      ...(options.has('--artifacts')
        ? { RATATOSKR_DATA_DIR: options.get('--artifacts')! }
        : {}),
    });
    if (process.env.RATATOSKR_APPLICATION_CONFIG) {
      const { loadApplicationDiagnostics } = await import('./diagnostics.js');
      await loadApplicationDiagnostics(
        process.env.RATATOSKR_APPLICATION_CONFIG,
      );
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    try {
      const result = await app.run(plan, controller.signal);
      const run = await app.runs.load(result.runId);
      const initialFailure = run.record.initialNavigation?.failure?.kind;
      const infrastructure =
        initialFailure === 'browser_execution' || controller.signal.aborted;
      if (report === 'junit')
        process.stdout.write(junitReport(result, infrastructure));
      else json(result);
      process.exitCode = runExitCode(result, infrastructure);
    } catch (error) {
      process.exitCode = 3;
      throw error;
    } finally {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
    }
    return;
  }
  const app = createRatatoskrApplication();
  if (command === 'compare') {
    const { positional, options } = flags(
      rest,
      ['--max-differences'],
      ['--timing'],
    );
    if (positional.length !== 2)
      throw new Error('Usage: compare <baselineRunId> <candidateRunId>');
    const result = await app.compare(positional[0]!, positional[1]!, {
      ...(options.has('--max-differences')
        ? { maxDifferences: Number(options.get('--max-differences')) }
        : {}),
      ...(options.has('--timing')
        ? {
            include: [
              'assertions',
              'network',
              'console',
              'navigation',
              'timing',
            ],
          }
        : {}),
    });
    json(result);
    if (result.status === 'regressed') process.exitCode = 1;
    else if (result.status === 'inconclusive') process.exitCode = 2;
    return;
  }
  if (command === 'diagnose' && rest.length === 1) {
    json(await app.diagnose(rest[0]!));
    return;
  }
  if (command === 'source' && rest.length === 3) {
    json(await app.source(rest[0]!, Number(rest[1]), Number(rest[2])));
    return;
  }
  if (command === 'derive-workflow') {
    const { positional, options } = flags(rest, ['--base-url']);
    if (positional.length !== 1)
      throw new Error('Usage: derive-workflow <test.ts> [--base-url URL]');
    const { deriveWorkflows } = await import('./derive-workflow.js');
    const workflows = deriveWorkflows(
      await readBoundedFile(resolve(positional[0]!)),
      positional[0]!,
      options.get('--base-url'),
    );
    json({ workflows });
    if (!workflows.length || workflows.some((workflow) => !workflow.ready))
      process.exitCode = 1;
    return;
  }
  if (command === 'inspect' && rest.length >= 1 && rest.length <= 2) {
    const aliases: Record<string, InspectionCategory> = {
      console: 'console_errors',
      network: 'failed_requests',
    };
    const requested = rest[1]
      ? rest[1].split(',').map((value) => aliases[value] ?? value)
      : ['summary', 'metrics', 'artifacts'];
    const include = requested.includes('all')
      ? InspectionCategorySchema.options
      : requested.map((value) => InspectionCategorySchema.parse(value));
    json(await app.inspect(rest[0]!, { include }));
    return;
  }
  if (
    command === 'artifact' &&
    (rest.length === 2 || (rest.length === 4 && rest[2] === '--out'))
  ) {
    const artifact = rest[3]
      ? await app.artifacts.copyTo(rest[0]!, rest[1]!, resolve(rest[3]))
      : await app.artifacts.get(rest[0]!, rest[1]!);
    json({
      ...artifact,
      ...(artifact.sensitive ? { path: undefined } : {}),
      ...(rest[3] ? { copiedTo: resolve(rest[3]) } : {}),
    });
    return;
  }
  throw new Error('Invalid command or arguments; use --help');
}
main(process.argv.slice(2)).catch((error: unknown) => {
  // Never dump validation input, workflow content, or resolved environment values.
  const message =
    error instanceof SyntaxError
      ? 'Malformed JSON input or configuration'
      : error instanceof Error && error.name !== 'ZodError'
        ? error.message.slice(0, 300)
        : 'Invalid input or configuration';
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode ||= 2;
});
