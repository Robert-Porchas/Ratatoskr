import { z } from 'zod';
import type {
  ArtifactReference,
  Evidence,
  RunRecord,
  StepResult,
} from './protocol.js';
import type { RunStore } from './storage.js';

export const InspectionCategorySchema = z.enum([
  'summary',
  'steps',
  'failed_requests',
  'console_errors',
  'page_errors',
  'navigation',
  'artifacts',
  'metrics',
]);
export type InspectionCategory = z.infer<typeof InspectionCategorySchema>;

export const InspectionOptionsSchema = z.strictObject({
  include: z.array(InspectionCategorySchema).min(1).max(8).default(['summary']),
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
  };
}

function section(
  category: InspectionCategory,
  record: RunRecord,
  steps: StepResult[],
  evidence: Evidence[],
  result: unknown,
  offset: number,
  limit: number,
): InspectionSection {
  switch (category) {
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
      parsed.offset,
      parsed.maxItemsPerCategory,
    );
  }
  return { runId, sections };
}
