import { z } from 'zod';
import type {
  ArtifactReference,
  Evidence,
  RunRecord,
  StepResult,
} from './protocol.js';
import type { RunStore } from './storage.js';
import { sanitizeSessionRecord, type SessionRecord } from './session.js';

export const InspectionCategorySchema = z.enum([
  'summary',
  'steps',
  'failed_requests',
  'console_errors',
  'page_errors',
  'navigation',
  'artifacts',
  'extracted_values',
  'metrics',
  'session',
]);
export type InspectionCategory = z.infer<typeof InspectionCategorySchema>;

export const InspectionOptionsSchema = z.strictObject({
  include: z
    .array(InspectionCategorySchema)
    .min(1)
    .max(10)
    .default(['summary']),
  maxItemsPerCategory: z.number().int().min(1).max(25).default(10),
  offset: z.number().int().min(0).max(10_000).default(0),
});
export type InspectionOptions = z.input<typeof InspectionOptionsSchema>;

export interface InspectionItems {
  items: unknown[];
  returnedCount: number;
  availableCount: number;
  truncated: boolean;
}

export type InspectionSection = InspectionItems | Record<string, unknown>;
export interface InspectionResult {
  runId: string;
  sections: Partial<Record<InspectionCategory, InspectionSection>>;
}

const shorten = (value: string): string => value.slice(0, 300);

function page<T>(items: T[], offset: number, limit: number): InspectionItems {
  const selected = items.slice(offset, offset + limit);
  return {
    items: selected,
    returnedCount: selected.length,
    availableCount: items.length,
    truncated: offset + selected.length < items.length,
  };
}

function artifactSummary(artifact: ArtifactReference): Record<string, unknown> {
  return {
    id: artifact.id,
    runId: artifact.runId,
    type: artifact.type,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    createdAt: artifact.createdAt,
    ...(artifact.fileName ? { fileName: artifact.fileName } : {}),
    ...(artifact.sensitive
      ? { sensitive: true, inlineRetrievalAllowed: false }
      : {}),
  };
}

function section(
  category: InspectionCategory,
  record: RunRecord,
  steps: StepResult[],
  evidence: Evidence[],
  result: unknown,
  extractions: Record<string, string>,
  offset: number,
  limit: number,
  session?: SessionRecord,
): InspectionSection {
  switch (category) {
    case 'session': {
      if (!session) return { ...page([], offset, limit), available: false };
      const safe = sanitizeSessionRecord(session, (value) => value);
      const final = safe.snapshots[safe.snapshots.length - 1];
      const items = [
        ...safe.changes.map((change) => ({ kind: 'change', ...change })),
        ...safe.responses.map((response) => ({
          kind: 'response',
          ...response,
          cookies: response.cookies.slice(0, 3),
          cookieCount: response.cookies.length,
          cookiesTruncated: response.cookies.length > 3,
        })),
        ...(final?.cookies ?? []).map((cookie) => ({
          kind: 'cookie',
          ...cookie,
          expired:
            cookie.expires !== -1 && cookie.expires * 1000 <= (final?.at ?? 0),
        })),
        ...(final?.storage ?? []).map((storage) => ({
          kind: 'storage_key',
          ...storage,
        })),
      ];
      const selected = page(items, offset, limit);
      while (Buffer.byteLength(JSON.stringify(selected.items)) > 6000)
        selected.items.pop();
      selected.returnedCount = selected.items.length;
      selected.truncated = offset + selected.returnedCount < items.length;
      return {
        ...selected,
        available: true,
        ...(final
          ? {
              cookieSnapshot: {
                at: final.at,
                observedCount: final.cookies.length,
                complete: final.cookiesComplete,
              },
            }
          : {}),
        captureTruncated:
          safe.truncated || !final?.cookiesComplete || !final?.storageComplete,
      };
    }
    case 'summary':
      return {
        status: record.status,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        result,
      };
    case 'metrics':
      return { ...record.metrics };
    case 'steps':
      return page(steps, offset, limit);
    case 'failed_requests':
      return page(
        evidence
          .filter(
            (event) => event.type === 'http' || event.type === 'request_failed',
          )
          .map((event) =>
            event.type === 'request_failed'
              ? { ...event, error: shorten(event.error) }
              : event,
          ),
        offset,
        limit,
      );
    case 'console_errors':
      return page(
        evidence
          .filter(
            (event) => event.type === 'console' && event.level === 'error',
          )
          .map((event) =>
            event.type === 'console'
              ? { ...event, message: shorten(event.message) }
              : event,
          ),
        offset,
        limit,
      );
    case 'page_errors':
      return page(
        evidence
          .filter((event) => event.type === 'page_error')
          .map((event) =>
            event.type === 'page_error'
              ? { ...event, message: shorten(event.message) }
              : event,
          ),
        offset,
        limit,
      );
    case 'navigation':
      return page(
        evidence.filter((event) => event.type === 'navigation'),
        offset,
        limit,
      );
    case 'artifacts':
      return page(record.artifacts.map(artifactSummary), offset, limit);
    case 'extracted_values':
      return page(
        Object.entries(extractions)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, value]) => ({ name, value: value.slice(0, 1000) })),
        offset,
        limit,
      );
  }
}

/** Bounded, deterministic disclosure of a persisted run. */
export async function inspectRun(
  runId: string,
  options: InspectionOptions,
  runs: RunStore,
): Promise<InspectionResult> {
  const parsed = InspectionOptionsSchema.parse(options);
  const run = await runs.load(runId);
  const sections: InspectionResult['sections'] = {};
  for (const category of [...new Set(parsed.include)]) {
    sections[category] = section(
      category,
      run.record,
      run.steps,
      run.evidence,
      run.result,
      run.extractions,
      parsed.offset,
      parsed.maxItemsPerCategory,
      run.session,
    );
  }
  return { runId, sections };
}
