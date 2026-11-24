import { describe, expect, it } from 'vitest';
import {
  compareRunRecords,
  ComparisonOptionsSchema,
} from '../src/compare-runs.js';
import { buildMetrics } from '../src/evidence.js';
import { workflowFingerprint } from '../src/run-metadata.js';
import type { BrowserPlan, Evidence, StepResult } from '../src/protocol.js';
import type { RunStore } from '../src/storage.js';

type Run = Awaited<ReturnType<RunStore['load']>>;
const plan: BrowserPlan = {
  startUrl: 'http://localhost:3000/profile',
  steps: [
    {
      action: 'assert_visible',
      target: { kind: 'role', role: 'button', name: 'Save' },
    },
    {
      action: 'assert_text',
      target: { kind: 'role', role: 'heading' },
      contains: 'Profile',
    },
  ],
};

function step(
  index: number,
  status: StepResult['status'] = 'passed',
  action: StepResult['action'] = index === 0 ? 'assert_visible' : 'assert_text',
): StepResult {
  return {
    index,
    action,
    status,
    startedAt: 100,
    endedAt: 200,
    durationMs: 100,
    ...(status === 'failed'
      ? {
          failure: {
            kind: 'assertion' as const,
            reason: 'Expected assertion failed',
          },
        }
      : {}),
  };
}
function run(
  options: {
    id?: string;
    steps?: StepResult[];
    evidence?: Evidence[];
    duration?: number;
  } = {},
): Run {
  const id = options.id ?? 'run_baseline';
  const steps = options.steps ?? [step(0), step(1)];
  const evidence = options.evidence ?? [];
  const failure = steps.find((item) => item.status === 'failed');
  return {
    record: {
      id,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:00:01Z',
      status: failure ? 'failed' : 'passed',
      initialNavigation: step(-1, 'passed', 'navigate'),
      metrics: buildMetrics(
        2,
        steps,
        evidence,
        options.duration ?? 1000,
        100,
        0,
      ),
      artifacts: [],
      verification: {
        schemaVersion: 1,
        ratatoskrVersion: '0.1.0',
        workflowFingerprint: workflowFingerprint(plan),
        targetOrigin: 'http://localhost:3000',
        browser: 'chromium',
        headless: true,
        viewport: { width: 1280, height: 720 },
        evidencePolicy: 'bounded-responses-v1',
        droppedEvents: 0,
        pendingRequests: 0,
        completed: true,
      },
    },
    plan: structuredClone(plan),
    steps,
    evidence,
    result: failure
      ? {
          success: false,
          runId: id,
          failedStep: failure.index,
          action: failure.action,
          reason: 'Expected assertion failed',
          relevantErrors: [],
        }
      : { success: true, runId: id },
    extractions: {},
  };
}
function http(
  status: number,
  overrides: Partial<Extract<Evidence, { type: 'http' }>> = {},
): Extract<Evidence, { type: 'http' }> {
  return {
    type: 'http',
    at: 100,
    stepIndex: 0,
    method: 'POST',
    path: '/api/profile',
    url: 'http://localhost:3000/api/profile',
    status,
    ...overrides,
  };
}
function consoleError(
  message: string,
  overrides: Partial<Extract<Evidence, { type: 'console' }>> = {},
): Extract<Evidence, { type: 'console' }> {
  return {
    type: 'console',
    at: 100,
    stepIndex: 0,
    level: 'error',
    message,
    ...overrides,
  };
}

describe('workflow fingerprints', () => {
  it('ignores object key ordering and undefined fields, preserving workflow values', () => {
    const reordered: BrowserPlan = {
      steps: [
        {
          target: { name: 'Save', role: 'button', kind: 'role' },
          action: 'assert_visible',
        },
        {
          contains: 'Profile',
          target: { role: 'heading', kind: 'role' },
          action: 'assert_text',
        },
      ],
      startUrl: plan.startUrl,
    };
    expect(workflowFingerprint(reordered)).toBe(workflowFingerprint(plan));
    expect(
      workflowFingerprint({ ...plan, parameters: undefined } as BrowserPlan),
    ).toBe(workflowFingerprint(plan));
    expect(workflowFingerprint(plan)).toMatch(/^[a-f0-9]{64}$/);
    expect(
      workflowFingerprint({ ...plan, startUrl: 'http://localhost:3000/other' }),
    ).not.toBe(workflowFingerprint(plan));
    expect(
      workflowFingerprint({ ...plan, steps: [...plan.steps].reverse() }),
    ).not.toBe(workflowFingerprint(plan));
  });
});

describe('deterministic run comparison', () => {
  it('ignores timestamps, durations by default, object ordering, and independent observation order', () => {
    const baseline = run({
      evidence: [
        http(200),
        http(204, { path: '/api/a', url: 'http://localhost:3000/api/a' }),
        { type: 'navigation', at: 100, stepIndex: null, url: plan.startUrl },
      ],
    });
    const candidate = structuredClone(baseline);
    candidate.record.id = 'run_candidate';
    candidate.record.startedAt = '2026-02-01T00:00:00Z';
    candidate.record.endedAt = '2026-02-01T00:00:05Z';
    candidate.record.metrics.durationMs = 5000;
    candidate.steps = candidate.steps.map((item) => ({
      ...item,
      startedAt: 900,
      endedAt: 990,
      durationMs: 90,
    }));
    candidate.evidence = [
      http(204, {
        at: 999,
        path: '/api/a',
        url: 'http://localhost:3000/api/a',
      }),
      http(200, { at: 888 }),
      { type: 'navigation', at: 999, stepIndex: null, url: plan.startUrl },
    ];
    candidate.plan = {
      steps: candidate.plan.steps,
      startUrl: candidate.plan.startUrl,
    };
    const result = compareRunRecords(baseline, candidate);
    expect(result.status).toBe('unchanged');
    expect(result.comparability).toBe('comparable');
    expect(result.differences).toEqual([]);
    expect(result.summary).toEqual({
      resolved: 0,
      introduced: 0,
      persistent: 0,
      changed: 0,
    });
  });

  it('identifies a passing assertion as observed improvement, and retains persistent failures', () => {
    const baseline = run({ steps: [step(0, 'failed'), step(1, 'failed')] });
    const candidate = run({
      id: 'run_candidate',
      steps: [step(0), step(1, 'failed')],
    });
    const result = compareRunRecords(baseline, candidate);
    expect(result.status).toBe('improved');
    expect(result.summary.resolved).toBe(1);
    expect(result.summary.persistent).toBe(1);
    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'assertion_outcome',
          key: '0:assert_visible',
          classification: 'resolved',
          before: 'failed:assertion',
          after: 'passed',
        }),
        expect.objectContaining({
          type: 'assertion_outcome',
          key: '1:assert_text',
          classification: 'persistent',
        }),
      ]),
    );
  });

  it('classifies new assertion failures as regressions even when another failure resolves', () => {
    const result = compareRunRecords(
      run({ steps: [step(0, 'failed'), step(1)] }),
      run({ steps: [step(0), step(1, 'failed')] }),
    );
    expect(result.status).toBe('regressed');
    expect(result.summary).toMatchObject({ introduced: 1, resolved: 1 });
  });

  it('identifies an observed 500 to 200 response without inferring success from absence', () => {
    const baseline = run({ evidence: [http(500)] });
    const result = compareRunRecords(baseline, run({ evidence: [http(200)] }));
    expect(result.status).toBe('improved');
    expect(result.differences).toEqual([
      expect.objectContaining({
        type: 'http_outcome',
        classification: 'resolved',
        before: 500,
        after: 200,
      }),
    ]);
    const absent = compareRunRecords(baseline, run());
    expect(absent.status).toBe('inconclusive');
    expect(absent.summary.resolved).toBe(0);
    expect(absent.limitations.join(' ')).toMatch(
      /absence is not a successful response/,
    );
    expect(absent.differences[0]).toMatchObject({
      type: 'unmatched_request',
      after: 'unobserved',
    });
  });

  it('pairs repeated requests by step, method, full sanitized origin/path, and occurrence', () => {
    const baseline = run({
      evidence: [
        http(500),
        http(503),
        http(502, { stepIndex: 1 }),
        http(501, { method: 'GET' }),
        http(504, { url: 'http://other.test/api/profile' }),
      ],
    });
    const candidate = run({
      evidence: [
        http(204, { url: 'http://other.test/api/profile' }),
        http(200),
        http(503),
        http(200, { method: 'get' }),
        http(200, { stepIndex: 1 }),
      ],
    });
    const result = compareRunRecords(baseline, candidate);
    expect(result.status).toBe('improved');
    expect(result.summary).toMatchObject({
      resolved: 4,
      persistent: 1,
      introduced: 0,
    });
    expect(
      result.differences.find((difference) =>
        difference.key.endsWith('/api/profile #2'),
      ),
    ).toMatchObject({ classification: 'persistent', before: 503, after: 503 });
    expect(
      result.differences.some((difference) =>
        difference.key.includes('1 POST'),
      ),
    ).toBe(true);
    expect(
      result.differences.some((difference) => difference.key.includes('0 GET')),
    ).toBe(true);
    expect(
      result.differences.some((difference) =>
        difference.key.includes('http://other.test'),
      ),
    ).toBe(true);
  });

  it('does not erase distinct path IDs or cross-origin request differences', () => {
    const result = compareRunRecords(
      run({
        evidence: [
          http(500, {
            path: '/api/profile/1',
            url: 'http://localhost:3000/api/profile/1',
          }),
        ],
      }),
      run({
        evidence: [
          http(200, {
            path: '/api/profile/2',
            url: 'http://localhost:3000/api/profile/2',
          }),
        ],
      }),
    );
    expect(result.status).toBe('inconclusive');
    expect(result.summary.resolved).toBe(0);
    expect(result.differences).toHaveLength(2);
  });

  it('preserves repeated-request occurrence ordering rather than hiding a new failure', () => {
    const result = compareRunRecords(
      run({ evidence: [http(500), http(200)] }),
      run({ evidence: [http(200), http(500)] }),
    );
    expect(result.status).toBe('regressed');
    expect(result.summary).toMatchObject({ introduced: 1, resolved: 1 });
  });

  it('matches transport failures to observed HTTP outcomes', () => {
    const baseline = run({
      evidence: [
        {
          type: 'request_failed',
          at: 100,
          stepIndex: 0,
          method: 'POST',
          path: '/api/profile',
          url: 'http://localhost:3000/api/profile',
          error: 'ERR_CONNECTION_RESET',
        },
      ],
    });
    expect(
      compareRunRecords(baseline, run({ evidence: [http(200)] })).summary
        .resolved,
    ).toBe(1);
    expect(compareRunRecords(baseline, baseline).summary.persistent).toBe(1);
  });

  it('reports incompatible workflow fingerprints and executed assertion coverage', () => {
    const baseline = run();
    const candidate = run({ steps: [step(0)] });
    candidate.record.verification!.workflowFingerprint = 'different';
    const result = compareRunRecords(baseline, candidate);
    expect(result.status).toBe('inconclusive');
    expect(result.limitations.join(' ')).toMatch(
      /Different workflowFingerprint/,
    );
    expect(result.limitations.join(' ')).toMatch(/Different executed steps/);
  });

  it('reports different viewport configurations', () => {
    const candidate = run();
    Object.assign(candidate.record.verification!.viewport, { width: 1920 });
    const result = compareRunRecords(run(), candidate);
    expect(result.status).toBe('inconclusive');
    expect(result.limitations).toContain('Different viewport');
  });

  it('treats equivalent viewport object key orders as comparable', () => {
    const candidate = run();
    candidate.record.verification!.viewport = { height: 720, width: 1280 };
    expect(compareRunRecords(run(), candidate).status).toBe('unchanged');
  });

  it.each([
    [
      'legacy metadata',
      (value: Run) => {
        delete value.record.verification;
      },
      /metadata unavailable/,
    ],
    [
      'truncated evidence',
      (value: Run) => {
        value.record.verification!.droppedEvents = 1;
      },
      /capture truncated/,
    ],
    [
      'pending requests',
      (value: Run) => {
        value.record.verification!.pendingRequests = 1;
      },
      /remained pending/,
    ],
    [
      'interrupted execution',
      (value: Run) => {
        value.record.verification!.completed = false;
      },
      /interrupted/,
    ],
    [
      'aborted run',
      (value: Run) => {
        value.record.status = 'aborted';
      },
      /Aborted run/,
    ],
  ] as const)('keeps %s inconclusive', (_name, alter, expected) => {
    const candidate = run();
    alter(candidate);
    const result = compareRunRecords(run(), candidate);
    expect(result.status).toBe('inconclusive');
    expect(result.comparability).toBe('limited');
    expect(result.limitations.join(' ')).toMatch(expected);
  });

  it('does not claim a query-driven endpoint resolved after omitted URL queries', () => {
    const result = compareRunRecords(
      run({ evidence: [http(500, { urlQueryOmitted: true })] }),
      run({ evidence: [http(200, { urlQueryOmitted: true })] }),
    );
    expect(result.status).toBe('inconclusive');
    expect(result.limitations.join(' ')).toMatch(/Query values omitted/);
  });

  it('reports unmatched failed assertions without treating skipped outcomes as passing', () => {
    const result = compareRunRecords(
      run({ steps: [step(0), step(1, 'failed')] }),
      run({ steps: [step(0)] }),
    );
    expect(result.status).toBe('inconclusive');
    expect(result.summary.resolved).toBe(0);
    expect(result.differences).toContainEqual(
      expect.objectContaining({
        type: 'unmatched_step_failure',
        classification: 'changed',
        before: 'failed',
        after: 'unobserved',
      }),
    );
  });

  it('identifies new, resolved and persistent console errors and JavaScript exceptions', () => {
    const pageError: Evidence = {
      type: 'page_error',
      at: 100,
      stepIndex: 0,
      message: 'Unhandled saved state',
    };
    const baseline = run({
      evidence: [
        consoleError('Persistent error'),
        consoleError('Old error'),
        pageError,
        consoleError('debug detail', { level: 'info' }),
      ],
    });
    const candidate = run({
      evidence: [
        consoleError('New error'),
        { ...pageError, at: 900 },
        consoleError('Persistent error', { at: 900 }),
      ],
    });
    const result = compareRunRecords(baseline, candidate);
    expect(result.status).toBe('regressed');
    expect(result.summary).toMatchObject({
      resolved: 1,
      introduced: 1,
      persistent: 2,
    });
    expect(result.differences).toHaveLength(4);
    expect(
      result.differences.some((difference) =>
        difference.key.includes('debug detail'),
      ),
    ).toBe(false);
  });

  it('keeps a repeated application error persistent when its count decreases', () => {
    const result = compareRunRecords(
      run({
        evidence: [
          consoleError('Still failing'),
          consoleError('Still failing'),
        ],
      }),
      run({ evidence: [consoleError('Still failing')] }),
    );
    expect(result.summary.resolved).toBe(0);
    expect(result.summary.persistent).toBe(1);
    expect(result.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: 'persistent',
          before: 2,
          after: 1,
        }),
        expect.objectContaining({
          type: 'application_error_count',
          classification: 'changed',
          before: 2,
          after: 1,
        }),
      ]),
    );
  });

  it('counts every difference while bounding details and string lengths', () => {
    const baseline = run();
    const candidate = run({
      evidence: Array.from({ length: 100 }, (_, index) =>
        consoleError(`Failure ${index}: ${'x'.repeat(1000)}`),
      ),
    });
    const result = compareRunRecords(baseline, candidate, {
      include: ['console'],
      maxDifferences: 2,
    });
    expect(result.status).toBe('regressed');
    expect(result.summary.introduced).toBe(100);
    expect(result.differences).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(
      result.differences.every((difference) => difference.key.length <= 180),
    ).toBe(true);
    expect(result).toEqual(
      compareRunRecords(baseline, candidate, {
        include: ['console'],
        maxDifferences: 2,
      }),
    );
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1500);
  });

  it('only compares timing when explicitly requested', () => {
    const baseline = run({ duration: 1000 });
    const candidate = run({ duration: 1500 });
    expect(compareRunRecords(baseline, candidate).differences).toEqual([]);
    expect(
      compareRunRecords(baseline, candidate, { include: ['timing'] }),
    ).toMatchObject({
      status: 'changed',
      differences: [
        {
          type: 'duration_ms',
          classification: 'changed',
          key: 'workflow',
          before: 1000,
          after: 1500,
        },
      ],
    });
  });

  it('respects evidence selection and bounds options', () => {
    const baseline = run({ evidence: [http(500)] });
    const candidate = run({ evidence: [http(200)] });
    expect(
      compareRunRecords(baseline, candidate, { include: ['assertions'] })
        .status,
    ).toBe('unchanged');
    for (const input of [
      { maxDifferences: 0 },
      { maxDifferences: 51 },
      { include: [] },
      { include: ['raw-dom'] },
    ])
      expect(ComparisonOptionsSchema.safeParse(input).success).toBe(false);
  });
});
