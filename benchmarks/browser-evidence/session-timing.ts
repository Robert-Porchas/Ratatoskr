import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createRatatoskrApplication } from '../../src/application.js';
import type { BrowserPlan } from '../../src/protocol.js';
import { createSessionFixture } from '../../test/fixture/session.js';
import { distribution } from './matrix-summary.js';

// This developer-only runner compares actual old/current executors, not model usage.
const oldEntry = process.argv[2];
const output = process.argv[3];
if (!oldEntry || !output)
  throw new Error('Pass the old compiled application.js path and output.json');
const old = (await import(pathToFileURL(resolve(oldEntry)).href)) as {
  createRatatoskrApplication: typeof createRatatoskrApplication;
};
const count = z.coerce
  .number()
  .int()
  .min(1)
  .max(50)
  .parse(process.env.BENCHMARK_RUNS ?? 10);
const fixture = createSessionFixture();
const data = await mkdtemp(join(tmpdir(), 'ratatoskr-session-timing-'));
const rows: Array<{
  mode: string;
  scenario: string;
  run: number;
  workflowMs: number;
  captureMs: number | null;
  diffMs: number | null;
  compactResultBytes: number;
  sessionBytes: number;
}> = [];
try {
  fixture.server.listen(0, '127.0.0.1');
  await once(fixture.server, 'listening');
  const address = fixture.server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture');
  for (const scenario of ['success', 'missing'] as const) {
    for (let run = 1; run <= count; run++) {
      const modes = run % 2 ? ['before', 'after'] : ['after', 'before'];
      for (const mode of modes) {
        const factory =
          mode === 'before'
            ? old.createRatatoskrApplication
            : createRatatoskrApplication;
        const app = factory({ RATATOSKR_DATA_DIR: join(data, mode) });
        const plan: BrowserPlan = {
          startUrl: `http://127.0.0.1:${address.port}/auth?scenario=${scenario}`,
          steps: [
            {
              action: 'click',
              target: { kind: 'role', role: 'button', name: 'Sign in' },
            },
            {
              action: 'assert_text',
              target: { kind: 'role', role: 'status' },
              contains: 'Sign-in accepted',
            },
            {
              action: 'click',
              target: { kind: 'role', role: 'button', name: 'Account details' },
            },
            {
              action: 'assert_text',
              target: { kind: 'testId', testId: 'detail' },
              contains: 'Account active',
            },
            {
              action: 'click',
              target: { kind: 'role', role: 'button', name: 'Settings' },
            },
            {
              action: 'assert_text',
              target: { kind: 'testId', testId: 'settings' },
              contains: 'Settings ready',
            },
            {
              action: 'click',
              target: { kind: 'role', role: 'button', name: 'Open dashboard' },
            },
            {
              action: 'assert_text',
              target: { kind: 'testId', testId: 'dashboard' },
              contains: 'Dashboard ready',
              timeoutMs: 600,
            },
          ],
        };
        const result = await app.run(plan);
        if (result.success !== (scenario === 'success'))
          throw new Error(`Unexpected ${mode}/${scenario} workflow outcome`);
        const saved = await app.runs.load(result.runId);
        rows.push({
          mode,
          scenario,
          run,
          workflowMs: saved.record.metrics.durationMs,
          captureMs: saved.record.metrics.session?.captureDurationMs ?? null,
          diffMs: saved.record.metrics.session?.diffDurationMs ?? null,
          compactResultBytes: Buffer.byteLength(JSON.stringify(result)),
          sessionBytes:
            result.success || !result.session
              ? 0
              : Buffer.byteLength(JSON.stringify(result.session)),
        });
      }
    }
  }
  const groups = [
    ...new Set(rows.map((row) => `${row.scenario}/${row.mode}`)),
  ].map((key) => ({
    key,
    durationMs: distribution(
      rows
        .filter((row) => `${row.scenario}/${row.mode}` === key)
        .map((row) => row.workflowMs),
    ),
  }));
  const summary = { runs: count, timeoutMs: 600, rows, groups };
  await writeFile(resolve(output), JSON.stringify(summary, null, 2) + '\n');
  process.stdout.write(JSON.stringify(groups, null, 2) + '\n');
} finally {
  fixture.server.closeAllConnections();
  await new Promise<void>((done) => fixture.server.close(() => done()));
  await rm(data, { recursive: true, force: true });
}
