import { describe, expect, it } from 'vitest';
import {
  EvidenceCollector,
  buildMetrics,
  relevantErrors,
} from '../src/evidence.js';
import type { Evidence, StepResult } from '../src/protocol.js';

const failed: StepResult = {
  index: 4,
  action: 'assert_url',
  status: 'failed',
  startedAt: 10_000,
  endedAt: 11_000,
  durationMs: 1000,
  failure: { kind: 'assertion', reason: 'wrong URL' },
};

describe('evidence reduction', () => {
  it('preserves workflow trace and condition vocabulary while redacting matching data', () => {
    const collector = new EvidenceCollector();
    collector.protect('retry');
    collector.protect('visible');
    expect(
      collector.sanitize({
        trace: [{ event: 'retry', name: 'retry' }],
        condition: {
          kind: 'visible',
          target: { kind: 'testId', testId: 'visible' },
        },
      }),
    ).toEqual({
      trace: [{ event: 'retry', name: '[REDACTED]' }],
      condition: {
        kind: 'visible',
        target: { kind: 'testId', testId: '[REDACTED]' },
      },
    });
  });
  it('prefers nearby HTTP failures over old errors', () => {
    const events: Evidence[] = [
      {
        type: 'console',
        level: 'error',
        message: 'old',
        at: 1000,
        stepIndex: 0,
      },
      {
        type: 'http',
        method: 'POST',
        path: '/api/login',
        status: 500,
        at: 10_200,
        stepIndex: 4,
      },
      { type: 'request', method: 'GET', path: '/', at: 10_100, stepIndex: 4 },
      {
        type: 'console',
        level: 'error',
        message: 'Failed to load resource: status 500',
        at: 10_250,
        stepIndex: 4,
      },
    ];
    expect(relevantErrors(events, failed)).toEqual([
      { type: 'http', method: 'POST', path: '/api/login', status: 500 },
    ]);
  });

  it('redacts protected values from browser messages and counts evidence', () => {
    const collector = new EvidenceCollector();
    collector.protect('my-');
    collector.protect('my-"secret');
    collector.setStep(2);
    collector.record({
      type: 'console',
      level: 'error',
      message: 'bad my-"secret',
    });
    expect(collector.events[0]).toMatchObject({
      message: 'bad [REDACTED]',
      stepIndex: 2,
    });
    expect(buildMetrics(1, [failed], collector.events, 50, 0, 0)).toMatchObject(
      {
        consoleErrorCount: 1,
        compressionRatio: 0,
      },
    );
  });

  it('redacts late session values without corrupting protocol keys or literals', () => {
    const collector = new EvidenceCollector();
    collector.record({
      type: 'console',
      level: 'error',
      message: 'type console error click SECRET',
    });
    for (const value of ['type', 'console', 'error', 'click', 'SECRET'])
      collector.protect(value);
    expect(collector.events[0]).toMatchObject({
      type: 'console',
      level: 'error',
      message: '[REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED]',
    });
    collector.record({ type: 'console', level: 'error', message: 'SECRET' });
    expect(collector.events[1]).toMatchObject({
      type: 'console',
      level: 'error',
      message: '[REDACTED]',
    });
    expect(
      collector.sanitize({
        action: 'click',
        target: { kind: 'text', text: 'click' },
      }),
    ).toEqual({
      action: 'click',
      target: { kind: 'text', text: '[REDACTED]' },
    });
  });
});
