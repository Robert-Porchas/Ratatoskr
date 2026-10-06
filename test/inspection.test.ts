import { describe, expect, it } from 'vitest';
import { inspectRun } from '../src/inspection.js';
import type {
  BrowserPlan,
  Evidence,
  RunRecord,
  RunResult,
  StepResult,
} from '../src/protocol.js';
import type { RunStore } from '../src/storage.js';
import type { SessionRecord } from '../src/session.js';

const runId = 'run_example';
const record: RunRecord = {
  id: runId,
  status: 'failed',
  startedAt: 'start',
  endedAt: 'end',
  artifacts: [],
  metrics: {
    stepCount: 1,
    durationMs: 1,
    browserActionCount: 1,
    failureCount: 1,
    networkRequestCount: 0,
    failedRequestCount: 0,
    consoleMessageCount: 3,
    consoleErrorCount: 3,
    pageErrorCount: 0,
    rawEvidenceEventCount: 3,
    rawEvidenceBytes: 1,
    reducedResponseBytes: 1,
    artifactCount: 0,
    compressionRatio: 1,
  },
};
const plan: BrowserPlan = {
  startUrl: 'http://local/',
  steps: [{ action: 'assert_url', contains: '/done' }],
};
const result: RunResult = {
  success: false,
  runId,
  failedStep: 0,
  action: 'assert_url',
  reason: 'wrong',
  relevantErrors: [],
};
const events: Evidence[] = [0, 1, 2].map((index) => ({
  type: 'console',
  level: 'error',
  message: `${index}${'x'.repeat(400)}`,
  at: index,
  stepIndex: 0,
}));
const store: RunStore = {
  async prepare() {},
  async save() {},
  async load() {
    return {
      record,
      plan,
      result,
      steps: [] as StepResult[],
      evidence: events,
      extractions: {},
    };
  },
};

describe('run inspection', () => {
  it('bounds session items and strips raw values even from injected snapshots', async () => {
    const session: SessionRecord = {
      snapshots: [
        {
          at: 1000,
          stepIndex: 0,
          cookiesComplete: true,
          storageComplete: true,
          cookies: Array.from({ length: 81 }, (_, index) => ({
            name: `session_${index}`,
            domain: 'localhost',
            path: '/',
            expires: 1,
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
            value: 'SUPER_SECRET_SESSION_VALUE_123',
          })),
          storage: [],
        },
      ],
      changes: [],
      responses: [],
      truncated: false,
    };
    const loaded = await store.load(runId);
    const sessionStore: RunStore = {
      ...store,
      async load() {
        return { ...loaded, session };
      },
    };
    const response = await inspectRun(
      runId,
      { include: ['session'], maxItemsPerCategory: 2 },
      sessionStore,
    );
    expect(response.sections.session).toMatchObject({
      returnedCount: 2,
      availableCount: 81,
      cookieSnapshot: { observedCount: 81, complete: true },
      truncated: true,
      items: [{ expired: true }, { expired: true }],
    });
    expect(JSON.stringify(response)).not.toContain('SUPER_SECRET');
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(1500);
  });
  it('selects and pages only requested categories', async () => {
    const inspected = await inspectRun(
      runId,
      { include: ['console_errors'], maxItemsPerCategory: 1, offset: 1 },
      store,
    );
    expect(Object.keys(inspected.sections)).toEqual(['console_errors']);
    expect(inspected.sections.console_errors).toMatchObject({
      returnedCount: 1,
      availableCount: 3,
      truncated: true,
      items: [{ message: expect.stringMatching(/^1x/) }],
    });
    const section = inspected.sections.console_errors;
    if (section && 'items' in section && Array.isArray(section.items))
      expect(JSON.stringify(section.items[0]).length).toBeLessThan(400);
  });

  it('rejects unsupported categories and unbounded limits', async () => {
    await expect(
      inspectRun(runId, { include: ['all' as 'summary'] }, store),
    ).rejects.toThrow();
    await expect(
      inspectRun(
        runId,
        { include: ['steps'], maxItemsPerCategory: 100 },
        store,
      ),
    ).rejects.toThrow();
  });
});
