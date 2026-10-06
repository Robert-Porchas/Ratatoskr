import type {
  Evidence,
  RelevantError,
  RunMetrics,
  StepResult,
} from './protocol.js';

export type EvidenceInput = Evidence extends infer E
  ? E extends Evidence
    ? Omit<E, 'at' | 'stepIndex'>
    : never
  : never;

export class EvidenceCollector {
  readonly events: Evidence[] = [];
  private stepIndex: number | null = null;
  private readonly secrets = new Set<string>();

  setStep(index: number | null): void {
    this.stepIndex = index;
  }

  protect(value: string): void {
    if (value.length === 0 || this.secrets.has(value)) return;
    this.secrets.add(value);
    // Console events can precede the asynchronous storage/header snapshot.
    for (let index = 0; index < this.events.length; index++)
      this.events[index] = this.sanitize(this.events[index]!);
  }

  redact(value: string): string {
    let redacted = value;
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length))
      redacted = redacted.replaceAll(secret, '[REDACTED]');
    return redacted;
  }

  sanitize<T>(value: T): T {
    const visit = (item: unknown): unknown => {
      if (typeof item === 'string') return this.redact(item);
      if (Array.isArray(item)) return item.map(visit);
      if (item && typeof item === 'object')
        return Object.fromEntries(
          Object.entries(item).map(([key, field]) => [
            this.redact(key),
            visit(field),
          ]),
        );
      return item;
    };
    return visit(value) as T;
  }

  record(input: EvidenceInput): void {
    const fields = Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        typeof value === 'string' ? this.redact(value) : value,
      ]),
    );
    const event = {
      ...fields,
      at: Date.now(),
      stepIndex: this.stepIndex,
    } as Evidence;
    this.events.push(event);
  }
}

function compact(event: Evidence): RelevantError | null {
  switch (event.type) {
    case 'http':
      return {
        type: 'http',
        method: event.method,
        path: event.path,
        status: event.status,
      };
    case 'request_failed':
      return {
        type: 'request_failed',
        method: event.method,
        path: event.path,
        error: event.error,
      };
    case 'page_error':
      return { type: 'page_error', message: event.message.slice(0, 200) };
    case 'console':
      return event.level === 'error'
        ? { type: 'console', message: event.message.slice(0, 200) }
        : null;
    case 'dialog':
      return event.expected
        ? null
        : { type: 'dialog', message: `Unexpected ${event.dialogType} dialog` };
    case 'popup':
      return event.expected
        ? null
        : { type: 'popup', message: 'Unexpected popup opened' };
    default:
      return null;
  }
}

/** Rank evidence from the failed step and a two-second margin; favor severe failures. */
export function relevantErrors(
  events: Evidence[],
  failedStep: StepResult,
  limit = 3,
): RelevantError[] {
  const nearbyHttp = events.some(
    (event) =>
      event.type === 'http' &&
      event.at >= failedStep.startedAt - 2000 &&
      event.at <= failedStep.endedAt + 2000,
  );
  const severity: Record<RelevantError['type'], number> = {
    http: 4,
    request_failed: 3,
    page_error: 2,
    console: 1,
    dialog: 3,
    popup: 3,
  };
  return events
    .flatMap((event) => {
      const reduced = compact(event);
      if (!reduced) return [];
      if (
        nearbyHttp &&
        event.type === 'console' &&
        event.message.startsWith('Failed to load resource:')
      )
        return [];
      const inWindow =
        event.at >= failedStep.startedAt - 2000 &&
        event.at <= failedStep.endedAt + 2000;
      const sameStep = event.stepIndex === failedStep.index;
      if (!inWindow && !sameStep) return [];
      const distance = Math.min(
        Math.abs(event.at - failedStep.startedAt),
        Math.abs(event.at - failedStep.endedAt),
      );
      return [
        {
          reduced,
          score:
            (sameStep ? 100 : 0) +
            (inWindow ? 50 : 0) +
            severity[reduced.type] * 10 -
            distance / 1000,
          at: event.at,
        },
      ];
    })
    .sort((a, b) => b.score - a.score || b.at - a.at)
    .slice(0, limit)
    .map(({ reduced }) => reduced);
}

export function buildMetrics(
  plannedStepCount: number,
  steps: StepResult[],
  events: Evidence[],
  durationMs: number,
  reducedResponseBytes: number,
  artifactCount: number,
  startupFailed = false,
): RunMetrics {
  const rawEvidenceBytes = Buffer.byteLength(
    events.map((event) => JSON.stringify(event)).join('\n'),
  );
  return {
    stepCount: plannedStepCount,
    durationMs,
    browserActionCount:
      1 + steps.filter((step) => !step.action.startsWith('assert_')).length,
    failureCount:
      steps.filter((step) => step.status === 'failed').length +
      Number(startupFailed),
    networkRequestCount: events.filter((event) => event.type === 'request')
      .length,
    failedRequestCount: events.filter(
      (event) => event.type === 'request_failed' || event.type === 'http',
    ).length,
    consoleMessageCount: events.filter((event) => event.type === 'console')
      .length,
    consoleErrorCount: events.filter(
      (event) => event.type === 'console' && event.level === 'error',
    ).length,
    pageErrorCount: events.filter((event) => event.type === 'page_error')
      .length,
    rawEvidenceEventCount: events.length,
    rawEvidenceBytes,
    reducedResponseBytes,
    artifactCount,
    compressionRatio:
      reducedResponseBytes === 0 ? 0 : rawEvidenceBytes / reducedResponseBytes,
  };
}
