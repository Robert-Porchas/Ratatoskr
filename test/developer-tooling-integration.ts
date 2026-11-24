import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRatatoskrApplication } from '../src/application.js';
import { BrowserPlanSchema } from '../src/protocol.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), 'ratatoskr-tooling-'));
await mkdir('.ratatoskr', { recursive: true });
// Keep generated test modules below the repository so Node resolves its installed
// @playwright/test. No external application or existing user test is modified.
const exportedDirectory = await mkdtemp(resolve('.ratatoskr/tooling-export-'));
let fail = true;
let regression = false;
let mutationCount = 0;
const credential = 'tooling-integration-private-name';
const server = createServer((request, response) => {
  if (request.url === '/interrupt') {
    response.end('<html><body><p>Waiting</p></body></html>');
    server.emit('workflowReady');
    return;
  }
  if (request.url === '/api/profile' && request.method === 'POST') {
    mutationCount++;
    request.resume();
    response.writeHead(fail ? 500 : 200, {
      'content-type': 'application/json',
      'x-request-id': 'profile-request-1',
    });
    response.end(JSON.stringify({ ok: !fail, regression }));
    return;
  }
  if (request.url === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(`<!doctype html><html><body>
    <label>Display name <input name="display"></label>
    <button>Save</button><p data-testid="status">Waiting</p>
    <script>
      document.querySelector('button').addEventListener('click', async () => {
        const response = await fetch('/api/profile', { method: 'POST' });
        const result = await response.json();
        if (result.regression) {
          console.error('New profile rendering regression');
          setTimeout(() => { throw new Error('New profile page exception'); }, 0);
        }
        document.querySelector('[data-testid="status"]').textContent = result.ok ? 'SAVED' : 'Unable to save';
      });
    </script></body></html>`);
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert(address && typeof address === 'object');
const base = `http://127.0.0.1:${address.port}`;
const environment = {
  ...process.env,
  RATATOSKR_DATA_DIR: join(workspace, 'data'),
  RATATOSKR_SESSION_DIAGNOSTICS: 'off',
  TEST_DISPLAY_NAME: credential,
};
const app = createRatatoskrApplication(environment);
const plan = BrowserPlanSchema.parse({
  startUrl: `${base}/profile`,
  steps: [
    {
      action: 'fill',
      target: { kind: 'label', label: 'Display name' },
      valueRef: 'TEST_DISPLAY_NAME',
    },
    { action: 'click', target: { kind: 'role', role: 'button', name: 'Save' } },
    {
      action: 'assert_text',
      target: { kind: 'testId', testId: 'status' },
      contains: 'Saved',
      timeoutMs: 1200,
    },
  ],
});
interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
function runNode(
  args: string[],
  cwd = workspace,
  overrides: NodeJS.ProcessEnv = {},
  interrupt = false,
): Promise<ProcessResult> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...environment, ...overrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const cancel = () => {
      child.kill('SIGTERM');
    };
    if (interrupt) server.once('workflowReady', cancel);
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Child process exceeded 45 seconds'));
    }, 45_000);
    const append = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next) > 512_000) {
        child.kill('SIGTERM');
        reject(new Error('Child process output exceeded 512000 bytes'));
      }
      return next;
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      server.removeListener('workflowReady', cancel);
      clearTimeout(timeout);
      done({ code, stdout, stderr });
    });
  });
}
function objectJSON(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  return parsed as Record<string, unknown>;
}

try {
  const baseline = await app.run(plan);
  assert.equal(baseline.success, false, JSON.stringify(baseline));
  assert.equal(mutationCount, 1, 'Failed mutations must not be replayed');
  fail = false;
  const candidate = await app.run(plan);
  assert.equal(candidate.success, true, JSON.stringify(candidate));
  const comparisonStarted = performance.now();
  const comparison = await app.compare(baseline.runId, candidate.runId);
  const comparisonDurationMs = performance.now() - comparisonStarted;
  assert(
    comparison.differences.some(
      (difference) =>
        difference.type === 'assertion_outcome' &&
        difference.classification === 'resolved',
    ),
  );
  assert(
    comparison.differences.some(
      (difference) =>
        difference.type === 'http_outcome' &&
        difference.before === 500 &&
        difference.after === 200 &&
        difference.classification === 'resolved',
    ),
  );
  assert.deepEqual(
    await app.compare(baseline.runId, candidate.runId),
    comparison,
    'Comparison must be deterministic',
  );
  assert.equal(
    comparison.status,
    comparison.limitations.length ? 'inconclusive' : 'improved',
  );
  const identical = await app.compare(candidate.runId, candidate.runId);
  assert.equal(identical.status, 'unchanged');
  assert.deepEqual(identical.differences, []);
  regression = true;
  const regressed = await app.run(plan);
  assert.equal(
    regressed.success,
    true,
    'Application errors do not invent workflow assertions',
  );
  const regressionComparison = await app.compare(
    candidate.runId,
    regressed.runId,
  );
  assert(
    regressionComparison.differences.some(
      (difference) =>
        difference.type === 'application_error' &&
        difference.classification === 'introduced' &&
        difference.key.includes('New profile'),
    ),
  );
  assert.equal(
    regressionComparison.status,
    regressionComparison.limitations.length ? 'inconclusive' : 'regressed',
  );
  for (const run of [baseline, candidate, regressed]) {
    const stored = await app.runs.load(run.runId);
    assert(
      !JSON.stringify(stored).includes(credential),
      'Persisted evidence must redact resolved values',
    );
    assert.equal(stored.record.verification?.schemaVersion, 1);
  }
  const inspected = await app.inspect(baseline.runId, {
    include: ['failed_requests'],
  });
  assert(JSON.stringify(inspected).includes('500'));
  const exported = await app.export(plan, {
    testName: 'profile saves successfully',
  });
  assert(exported.ready && 'artifact' in exported && exported.artifact);
  const source = (
    await app.artifacts.read(exported.artifact.id, 64_000)
  ).toString();
  assert(source.includes('requiredEnv("TEST_DISPLAY_NAME")'));
  assert(!source.includes(credential));
  const generatedPath = join(exportedDirectory, 'profile.spec.ts');
  await writeFile(generatedPath, source);
  const configPath = join(exportedDirectory, 'playwright.config.mjs');
  await writeFile(
    configPath,
    `export default {
    testDir: ${JSON.stringify(exportedDirectory)},
    outputDir: ${JSON.stringify(join(exportedDirectory, 'results'))},
    workers: 1, retries: 0, reporter: 'json',
    use: { browserName: 'chromium', headless: true }
  };`,
  );
  regression = false;
  const playwrightCLI = resolve('node_modules/@playwright/test/cli.js');
  const generated = await runNode(
    [playwrightCLI, 'test', '--config', configPath],
    exportedDirectory,
  );
  assert.equal(generated.code, 0, generated.stderr + generated.stdout);
  const report = objectJSON(generated.stdout);
  assert(report.stats && typeof report.stats === 'object');
  assert.equal((report.stats as Record<string, unknown>).expected, 1);
  assert.equal((report.stats as Record<string, unknown>).unexpected, 0);

  const planPath = join(workspace, 'profile.flow.json');
  await writeFile(planPath, JSON.stringify(plan));
  const validated = await runNode([cli, 'validate', planPath]);
  assert.equal(validated.code, 0, validated.stderr);
  assert.deepEqual(objectJSON(validated.stdout), { valid: true });
  const cliComparison = await runNode([
    cli,
    'compare',
    baseline.runId,
    candidate.runId,
  ]);
  assert.equal(cliComparison.code, 0, cliComparison.stderr);
  assert.deepEqual(objectJSON(cliComparison.stdout), comparison);
  const cliPassed = await runNode([
    cli,
    'run',
    planPath,
    '--report',
    'json',
    '--artifacts',
    join(workspace, 'cli-artifacts'),
  ]);
  assert.equal(cliPassed.code, 0, cliPassed.stderr + cliPassed.stdout);
  assert.equal(objectJSON(cliPassed.stdout).success, true);
  fail = true;
  const cliFailed = await runNode([cli, 'run', planPath]);
  assert.equal(cliFailed.code, 1, cliFailed.stderr + cliFailed.stdout);
  assert.equal(objectJSON(cliFailed.stdout).success, false);
  const junit = await runNode([cli, 'run', planPath, '--report', 'junit']);
  assert.equal(junit.code, 1, junit.stderr);
  assert(junit.stdout.startsWith('<?xml version="1.0"'));
  assert(junit.stdout.includes('failures="1" errors="0"'));
  assert(junit.stdout.includes('<failure message='));
  assert(junit.stdout.includes('<system-out>'));
  const cliExport = await runNode([
    cli,
    'export',
    planPath,
    '--out',
    'profile.spec.ts',
    '--name',
    'exported profile',
  ]);
  assert.equal(cliExport.code, 0, cliExport.stderr + cliExport.stdout);
  assert.equal(objectJSON(cliExport.stdout).ready, true);
  const exportedPath = join(workspace, 'profile.spec.ts');
  const firstSource = await readFile(exportedPath, 'utf8');
  assert(firstSource.includes('exported profile'));
  assert(!firstSource.includes(credential));
  const overwrite = await runNode([
    cli,
    'export',
    planPath,
    '--out',
    'profile.spec.ts',
  ]);
  assert.equal(overwrite.code, 2, overwrite.stdout + overwrite.stderr);
  assert.equal(await readFile(exportedPath, 'utf8'), firstSource);
  const invalidFlags = await runNode([cli, 'run', planPath, '--unknown']);
  assert.equal(invalidFlags.code, 2);
  assert.equal(invalidFlags.stdout, '');
  assert.equal(typeof objectJSON(invalidFlags.stderr).error, 'string');
  const invalidPath = join(workspace, 'invalid.flow.json');
  await writeFile(invalidPath, '{"startUrl":"file:///private","steps":[]}');
  const invalid = await runNode([cli, 'validate', invalidPath]);
  assert.equal(invalid.code, 2);
  assert.equal(invalid.stdout, '');
  assert.equal(typeof objectJSON(invalid.stderr).error, 'string');
  await writeFile(invalidPath, '{"token":"DO_NOT_ECHO_MALFORMED_SECRET",oops}');
  const malformed = await runNode([cli, 'validate', invalidPath]);
  assert.equal(malformed.code, 2);
  assert(!malformed.stderr.includes('DO_NOT_ECHO_MALFORMED_SECRET'));
  const unavailable = await runNode(
    [cli, 'run', planPath, '--report', 'junit'],
    workspace,
    { PLAYWRIGHT_BROWSERS_PATH: join(workspace, 'missing-browsers') },
  );
  assert.equal(unavailable.code, 3, unavailable.stderr + unavailable.stdout);
  assert(unavailable.stdout.includes('failures="0" errors="1"'));
  const doctorData = join(workspace, 'doctor-uncreated', 'data');
  const doctor = await runNode([cli, 'doctor', '--json'], workspace, {
    RATATOSKR_DATA_DIR: doctorData,
  });
  assert.equal(doctor.code, 0, doctor.stderr + doctor.stdout);
  assert.equal(objectJSON(doctor.stdout).ready, true);
  await assert.rejects(readFile(doctorData), { code: 'ENOENT' });
  const interruptedPath = join(workspace, 'interrupted.flow.json');
  await writeFile(
    interruptedPath,
    JSON.stringify({
      startUrl: `${base}/interrupt`,
      steps: [
        {
          action: 'wait_for',
          target: { kind: 'text', text: 'Never appears' },
          timeoutMs: 30000,
        },
      ],
    }),
  );
  const interrupted = await runNode(
    [cli, 'run', interruptedPath],
    workspace,
    {},
    true,
  );
  assert.equal(interrupted.code, 3, interrupted.stderr + interrupted.stdout);
  const interruptedResult = objectJSON(interrupted.stdout);
  assert.equal(interruptedResult.success, false);
  assert.equal(
    (await app.runs.load(String(interruptedResult.runId))).record.status,
    'aborted',
  );
  process.stdout.write(
    JSON.stringify({
      developerTooling: 'passed',
      comparisonStatus: comparison.status,
      comparisonLimitations: comparison.limitations,
      generatedTests: 1,
      measurements: {
        comparisonDurationMs,
        candidateDurationMs: (await app.runs.load(candidate.runId)).record
          .metrics.durationMs,
        candidateLocalEvidenceBytes: (await app.runs.load(candidate.runId))
          .record.metrics.rawEvidenceBytes,
        passingResultBytes: Buffer.byteLength(JSON.stringify(candidate)),
        failingResultBytes: Buffer.byteLength(JSON.stringify(baseline)),
        comparisonBytes: Buffer.byteLength(JSON.stringify(comparison)),
        regressionComparisonBytes: Buffer.byteLength(
          JSON.stringify(regressionComparison),
        ),
        exportMetadataBytes: Buffer.byteLength(JSON.stringify(exported)),
        generatedSourceBytes: Buffer.byteLength(source),
        inspectionBytes: Buffer.byteLength(JSON.stringify(inspected)),
      },
    }) + '\n',
  );
} finally {
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  await rm(workspace, { recursive: true, force: true });
  await rm(exportedDirectory, { recursive: true, force: true });
}
