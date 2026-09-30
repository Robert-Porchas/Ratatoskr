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
