import { z } from 'zod';
import type { Evidence, StepResult } from './protocol.js';
import type { RunStore } from './storage.js';

export const ComparisonOptionsSchema = z.strictObject({
  include: z
    .array(z.enum(['assertions', 'network', 'console', 'navigation', 'timing']))
    .min(1)
    .max(5)
    .default(['assertions', 'network', 'console', 'navigation']),
  maxDifferences: z.number().int().min(1).max(50).default(20),
});
export type ComparisonOptions = z.input<typeof ComparisonOptionsSchema>;
type Run = Awaited<ReturnType<RunStore['load']>>;
type Classification = 'resolved' | 'introduced' | 'persistent' | 'changed';
interface Difference {
  type: string;
  classification: Classification;
  key: string;
  before?: string | number | boolean;
  after?: string | number | boolean;
}
export interface RunComparison {
  baselineRunId: string;
  candidateRunId: string;
  status: 'improved' | 'regressed' | 'unchanged' | 'changed' | 'inconclusive';
  comparability: 'comparable' | 'limited';
  limitations: string[];
  summary: Record<Classification, number>;
  differences: Difference[];
  truncated: boolean;
}

const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const short = (value: string) =>
  value.length > 180 ? `${value.slice(0, 177)}...` : value;

const verificationSchema = z.object({
  schemaVersion: z.literal(1),
  ratatoskrVersion: z.string().max(64),
  workflowFingerprint: z.string().min(1).max(128),
  targetOrigin: z.string().max(2048),
  browser: z.string().max(64),
  headless: z.boolean(),
  viewport: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  evidencePolicy: z.string().max(128),
  droppedEvents: z.number().int().nonnegative(),
  pendingRequests: z.number().int().nonnegative(),
  completed: z.boolean(),
});

function coverage(run: Run): string {
  return JSON.stringify(
    run.steps.map(({ index, action, branch }) => [index, action, branch]),
  );
}

/** No fuzzy message/ID matching: it could hide a different application failure. */
export function compareRunRecords(
  baseline: Run,
  candidate: Run,
  options: ComparisonOptions = {},
): RunComparison {
  const { include, maxDifferences } = ComparisonOptionsSchema.parse(options);
  const limitations: string[] = [];
  const parsedA = verificationSchema.safeParse(baseline.record.verification);
  const parsedB = verificationSchema.safeParse(candidate.record.verification);
  const a = parsedA.success ? parsedA.data : undefined;
  const b = parsedB.success ? parsedB.data : undefined;
  if (!a || !b || a.schemaVersion !== 1 || b.schemaVersion !== 1)
    limitations.push(
      'Versioned verification metadata unavailable or unsupported',
    );
  if (a && b) {
    for (const field of [
      'workflowFingerprint',
      'targetOrigin',
      'browser',
      'headless',
      'evidencePolicy',
    ] as const)
      if (JSON.stringify(a[field]) !== JSON.stringify(b[field]))
        limitations.push(`Different ${field}`);
    if (
      a.viewport.width !== b.viewport.width ||
      a.viewport.height !== b.viewport.height
    )
      limitations.push('Different viewport');
    if (!a.completed || !b.completed)
      limitations.push(
        'Execution interrupted or initial navigation incomplete',
      );
    if (a.droppedEvents || b.droppedEvents)
      limitations.push('Evidence capture truncated');
    if (a.pendingRequests || b.pendingRequests)
      limitations.push('Requests remained pending at capture boundary');
  }
  if (coverage(baseline) !== coverage(candidate))
    limitations.push(
      'Different executed steps or branch choices; missing outcomes are not resolutions',
    );
  if (
    baseline.record.status === 'aborted' ||
    candidate.record.status === 'aborted'
  )
    limitations.push('Aborted run');
  if (
    (include.includes('network') || include.includes('navigation')) &&
    [...baseline.evidence, ...candidate.evidence].some(
      (event) => 'urlQueryOmitted' in event && event.urlQueryOmitted,
    )
  )
    limitations.push(
      'Query values omitted for privacy; query-driven endpoint identity is incomplete',
    );
  const summary = { resolved: 0, introduced: 0, persistent: 0, changed: 0 };
  const differences: Difference[] = [];
  let total = 0;
  const add = (difference: Difference) => {
    summary[difference.classification]++;
    total++;
    if (differences.length < maxDifferences)
      differences.push({
        ...difference,
        key: short(difference.key),
        ...(typeof difference.before === 'string'
          ? { before: short(difference.before) }
          : {}),
        ...(typeof difference.after === 'string'
          ? { after: short(difference.after) }
          : {}),
      });
  };
  const paired = <T>(
    left: Map<string, T>,
    right: Map<string, T>,
    visit: (key: string, before: T | undefined, after: T | undefined) => void,
  ) => {
    for (const key of [...new Set([...left.keys(), ...right.keys()])].sort(
      lexical,
    ))
      visit(key, left.get(key), right.get(key));
  };
  if (include.includes('assertions')) {
    const steps = (run: Run) =>
      new Map(
        [
          ...(run.record.initialNavigation
            ? [run.record.initialNavigation]
            : []),
          ...run.steps,
        ].map((step) => [`${step.index}:${step.action}`, step]),
      );
    paired(steps(baseline), steps(candidate), (key, before, after) => {
      if (!before || !after) {
        if (before?.status === 'failed' || after?.status === 'failed')
          add({
            type: 'unmatched_step_failure',
            classification: 'changed',
            key,
            before: before?.status ?? 'unobserved',
            after: after?.status ?? 'unobserved',
          });
        return;
      }
      const outcome = (step: StepResult) =>
        step.status === 'failed'
          ? `failed:${step.failure?.kind ?? 'unknown'}`
          : 'passed';
      if (before.status === 'failed' || after.status === 'failed')
        add({
          type: key.includes(':assert_') ? 'assertion_outcome' : 'step_outcome',
          key,
          classification:
            before.status === 'failed' && after.status === 'passed'
              ? 'resolved'
              : before.status === 'passed' && after.status === 'failed'
                ? 'introduced'
                : outcome(before) === outcome(after)
                  ? 'persistent'
                  : 'changed',
          before: outcome(before),
          after: outcome(after),
        });
    });
  }
  if (baseline.record.status !== candidate.record.status)
    add({
      type: 'workflow_result',
      classification: 'changed',
      key: 'workflow',
      before: baseline.record.status,
      after: candidate.record.status,
    });
  if (include.includes('network')) {
    const network = (events: Evidence[]) => {
      const result = new Map<string, number | string>();
      const counts = new Map<string, number>();
      for (const event of events) {
        if (event.type !== 'http' && event.type !== 'request_failed') continue;
        // Never normalize path segments, IDs, or distinct origins away.
        const identity = `${event.stepIndex ?? 'initial'} ${event.method.toUpperCase()} ${event.url ?? event.path}`;
        const occurrence = (counts.get(identity) ?? 0) + 1;
        counts.set(identity, occurrence);
        result.set(
          `${identity} #${occurrence}`,
          event.type === 'http' ? event.status : `failed:${event.error}`,
        );
      }
      return result;
    };
    const failed = (value: number | string | undefined) =>
      typeof value === 'string' || (typeof value === 'number' && value >= 400);
    paired(
      network(baseline.evidence),
      network(candidate.evidence),
      (key, before, after) => {
        if (before === after && !failed(before)) return;
        if (before === undefined || after === undefined) {
          limitations.push(
            'Unmatched network observations; absence is not a successful response',
          );
          add({
            type: 'unmatched_request',
            classification: 'changed',
            key,
            before: before ?? 'unobserved',
            after: after ?? 'unobserved',
          });
        } else
          add({
            type: 'http_outcome',
            key,
            before,
            after,
            classification:
              failed(before) && !failed(after)
                ? 'resolved'
                : !failed(before) && failed(after)
                  ? 'introduced'
                  : before === after
                    ? 'persistent'
                    : 'changed',
          });
      },
    );
  }
  if (include.includes('console')) {
    const errors = (events: Evidence[]) => {
      const counts = new Map<string, number>();
      for (const event of events) {
        if (
          event.type !== 'page_error' &&
          !(event.type === 'console' && event.level === 'error')
        )
          continue;
        const key = `${event.stepIndex ?? 'initial'} ${event.type}: ${event.message}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    };
    paired(
      errors(baseline.evidence),
      errors(candidate.evidence),
      (key, before = 0, after = 0) => {
        if (before === after) {
          if (before)
            add({
              type: 'application_error',
              classification: 'persistent',
              key,
              before,
              after,
            });
          return;
        }
        if (before && after) {
          add({
            type: 'application_error',
            classification: 'persistent',
            key,
            before,
            after,
          });
          add({
            type: 'application_error_count',
            classification: after > before ? 'introduced' : 'changed',
            key,
            before,
            after,
          });
          return;
        }
        add({
          type: 'application_error',
          classification: after > before ? 'introduced' : 'resolved',
          key,
          before,
          after,
        });
      },
    );
  }
  if (include.includes('navigation')) {
    const urls = (run: Run) =>
      new Map(
        run.evidence
          .filter((event) => event.type === 'navigation')
          .map((event, index) => [`navigation:${index}`, event.url]),
      );
    paired(urls(baseline), urls(candidate), (key, before, after) => {
      if (before !== after)
        add({
          type: 'navigation_changed',
          classification: 'changed',
          key,
          before: before ?? 'unobserved',
          after: after ?? 'unobserved',
        });
    });
  }
  if (
    include.includes('timing') &&
    baseline.record.metrics.durationMs !== candidate.record.metrics.durationMs
  )
    add({
      type: 'duration_ms',
      classification: 'changed',
      key: 'workflow',
      before: baseline.record.metrics.durationMs,
      after: candidate.record.metrics.durationMs,
    });
  const uniqueLimitations = [...new Set(limitations)].slice(0, 20);
  return {
    baselineRunId: baseline.record.id,
    candidateRunId: candidate.record.id,
    status: uniqueLimitations.length
      ? 'inconclusive'
      : summary.introduced
        ? 'regressed'
        : summary.resolved
          ? 'improved'
          : summary.changed
            ? 'changed'
            : 'unchanged',
    comparability: uniqueLimitations.length ? 'limited' : 'comparable',
    limitations: uniqueLimitations,
    summary,
    differences,
    truncated: total > differences.length,
  };
}

export async function compareRuns(
  baselineId: string,
  candidateId: string,
  runs: RunStore,
  options: ComparisonOptions = {},
): Promise<RunComparison> {
  const [baseline, candidate] = await Promise.all([
    runs.load(baselineId),
    runs.load(candidateId),
  ]);
  return compareRunRecords(baseline, candidate, options);
}
