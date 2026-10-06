import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRatatoskrApplication } from '../src/application.js';
import type { BrowserPlan, BrowserStep } from '../src/protocol.js';
import { inspectRun } from '../src/inspection.js';
import {
  createSessionFixture,
  FAKE_SESSION_SECRET,
  FAKE_STORAGE_SECRET,
  FAKE_HEADER_SECRET,
  type AuthScenario,
} from './fixture/session.js';

export function authSteps(scenario: AuthScenario): BrowserStep[] {
  return [
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
    ...(scenario === 'loss'
      ? [
          {
            action: 'click' as const,
            target: { kind: 'role' as const, role: 'button', name: 'Sign out' },
          },
          {
            action: 'assert_text' as const,
            target: { kind: 'role' as const, role: 'status' },
            contains: 'Signed out',
          },
        ]
      : []),
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
    ...(scenario === 'unrelated'
      ? [
          {
            action: 'assert_visible' as const,
            target: {
              kind: 'role' as const,
              role: 'button',
              name: 'Nonexistent unrelated control',
            },
            timeoutMs: 250,
          },
        ]
      : []),
  ];
}

const fixture = createSessionFixture();
const root = await mkdtemp(join(tmpdir(), 'ratatoskr-session-'));
try {
  fixture.server.listen(0, '127.0.0.1');
  await once(fixture.server, 'listening');
  const address = fixture.server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const app = createRatatoskrApplication({
    RATATOSKR_DATA_DIR: root,
    RATATOSKR_CAPTURE_AUTH_STATE: '1',
  });
  const demonstrations: unknown[] = [];
  for (const scenario of [
    'success',
    'missing',
    'loss',
    'scope',
    'unrelated',
  ] as const) {
    const plan: BrowserPlan = {
      startUrl: `${base}/auth?scenario=${scenario}`,
      steps: authSteps(scenario),
    };
    const result = await app.run(plan);
    assert.equal(
      result.success,
      scenario === 'success',
      JSON.stringify(result),
    );
    const stored = await app.runs.load(result.runId);
    const inspection = await inspectRun(
      result.runId,
      {
        include: ['session', 'console_errors', 'artifacts'],
        maxItemsPerCategory: 25,
      },
      app.runs,
    );
    assert(stored.record.metrics.session);
    assert((stored.session?.snapshots.length ?? 0) > 2);
    for (const output of [result, inspection, stored]) {
      assert(!JSON.stringify(output).includes(FAKE_SESSION_SECRET));
      assert(!JSON.stringify(output).includes(FAKE_STORAGE_SECRET));
      assert(!JSON.stringify(output).includes('fingerprint'));
    }
    if (!result.success) {
      if (scenario === 'unrelated')
        assert(!result.session, JSON.stringify(result));
      else {
        assert(result.session, JSON.stringify(result));
        assert(Buffer.byteLength(JSON.stringify(result.session)) < 750);
        assert(!result.artifacts?.trace);
        const state = stored.record.artifacts.find(
          (artifact) => artifact.type === 'browser_storage_state',
        );
        assert(state);
        assert(state.sensitive && state.inlineRetrievalAllowed === false);
        await assert.rejects(
          app.artifacts.read(state.id, 100000),
          /prohibited/,
        );
        const body = (
          await app.artifacts.readProtectedState(state.id)
        ).toString();
        if (scenario === 'scope') assert(body.includes(FAKE_SESSION_SECRET));
      }
      if (scenario === 'missing')
        assert(
          result.session?.findings.some(
            (item) => item.kind === 'cookie_not_retained',
          ),
        );
      if (scenario === 'loss')
        assert(
          result.session?.findings.some(
            (item) => item.kind === 'cookie_removed',
          ),
        );
    } else assert.deepEqual(Object.keys(result).sort(), ['runId', 'success']);
    // Ordinary files remain non-credential-bearing, including steps/workflow/console.
    for (const name of await readdir(join(root, 'runs', result.runId))) {
      if (name === 'artifacts') continue;
      const body = await readFile(
        join(root, 'runs', result.runId, name),
        'utf8',
      );
      assert(
        !body.includes(FAKE_SESSION_SECRET) &&
          !body.includes(FAKE_STORAGE_SECRET),
        name,
      );
    }
    demonstrations.push({
      scenario,
      result,
      metrics: stored.record.metrics.session,
      inspectionBytes: Buffer.byteLength(
        JSON.stringify(inspection.sections.session),
      ),
    });
  }
  const echo = await app.run({
    startUrl: `${base}/auth?echo=1`,
    steps: [
      {
        action: 'extract_text',
        target: { kind: 'testId', testId: 'echo' },
        saveAs: 'echo',
        maxChars: 10,
      },
      {
        action: 'assert_text',
        target: { kind: 'testId', testId: 'echo' },
        contains: 'not present',
        timeoutMs: 100,
      },
    ],
    outputs: ['echo'],
  });
  assert(!echo.success);
  assert.equal(echo.outputs?.echo, '[REDACTED]');
  assert.equal(echo.actualText, '[REDACTED]');
  assert(
    !JSON.stringify(await app.runs.load(echo.runId)).includes(
      FAKE_SESSION_SECRET,
    ),
  );
  const headerEcho = await app.run({
    startUrl: `${base}/auth?headers=1`,
    steps: [
      {
        action: 'assert_text',
        target: { kind: 'testId', testId: 'echo' },
        contains: FAKE_HEADER_SECRET,
      },
      {
        action: 'extract_text',
        target: { kind: 'testId', testId: 'echo' },
        saveAs: 'header',
      },
    ],
    outputs: ['header'],
  });
  assert(headerEcho.success);
  assert.equal(headerEcho.outputs?.header, '[REDACTED]');
  const headerSaved = await app.runs.load(headerEcho.runId);
  assert(!JSON.stringify(headerSaved).includes(FAKE_HEADER_SECRET));
  assert(
    !headerSaved.record.artifacts.some((artifact) => artifact.type === 'trace'),
  );
  process.stdout.write(
    `${JSON.stringify({ sessionDemonstrations: demonstrations, echoRedacted: true })}\n`,
  );
} finally {
  fixture.server.closeAllConnections();
  await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
