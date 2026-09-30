import { z } from 'zod';

const nonEmpty = z.string().min(1);
const httpUrl = z
  .url()
  .refine((value) => /^https?:\/\//.test(value), 'Expected an HTTP(S) URL');
const targetSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('role'),
    role: nonEmpty,
    name: nonEmpty.optional(),
  }),
  z.strictObject({ kind: z.literal('label'), label: nonEmpty }),
  z.strictObject({ kind: z.literal('text'), text: nonEmpty }),
  z.strictObject({ kind: z.literal('testId'), testId: nonEmpty }),
  z.strictObject({ kind: z.literal('css'), selector: nonEmpty }),
]);

const options = {
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  continueOnFailure: z.boolean().optional(),
};

export const BrowserTargetSchema = targetSchema;
export type BrowserTarget = z.infer<typeof BrowserTargetSchema>;

export const BrowserStepSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('navigate'), url: httpUrl, ...options }),
  z.strictObject({
    action: z.literal('click'),
    target: targetSchema,
    ...options,
  }),
  z.strictObject({
    action: z.literal('fill'),
    target: targetSchema,
    valueRef: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    ...options,
  }),
  z.strictObject({
    action: z.literal('press'),
    target: targetSchema,
    key: nonEmpty,
    ...options,
  }),
  z.strictObject({
    action: z.literal('wait_for'),
    target: targetSchema,
    ...options,
  }),
  z.strictObject({
    action: z.literal('assert_url'),
    contains: nonEmpty,
    ...options,
  }),
  z.strictObject({
    action: z.literal('assert_text'),
    target: targetSchema,
    contains: nonEmpty,
    ...options,
  }),
  z.strictObject({
    action: z.literal('assert_visible'),
    target: targetSchema,
    ...options,
  }),
]);
export type BrowserStep = z.infer<typeof BrowserStepSchema>;

export const BrowserPlanSchema = z.strictObject({
  startUrl: httpUrl,
  steps: z.array(BrowserStepSchema).min(1).max(100),
});
export type BrowserPlan = z.infer<typeof BrowserPlanSchema>;

export type RunIdentifier = string;
export type ArtifactType = 'screenshot' | 'trace';
export interface ArtifactReference {
  id: string;
  runId: RunIdentifier;
  type: ArtifactType;
  path: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export type Evidence =
  | {
      type: 'request';
      at: number;
      stepIndex: number | null;
      method: string;
      path: string;
    }
  | {
      type: 'http';
      at: number;
      stepIndex: number | null;
      method: string;
      path: string;
      status: number;
    }
  | {
      type: 'request_failed';
      at: number;
      stepIndex: number | null;
      method: string;
      path: string;
      error: string;
    }
  | {
      type: 'console';
      at: number;
      stepIndex: number | null;
      level: string;
      message: string;
    }
  | {
      type: 'page_error';
      at: number;
      stepIndex: number | null;
      message: string;
    }
  | { type: 'navigation'; at: number; stepIndex: number | null; url: string };

export type FailureKind =
  | 'element_not_found'
  | 'timeout'
  | 'assertion'
  | 'navigation'
  | 'secret_resolution'
  | 'browser_execution';
export interface StepResult {
  index: number;
  action: BrowserStep['action'];
  status: 'passed' | 'failed';
  startedAt: number;
  endedAt: number;
  durationMs: number;
  actualUrl?: string;
  failure?: { kind: FailureKind; reason: string };
}

export type RelevantError =
  | { type: 'http'; method: string; path: string; status: number }
  | { type: 'request_failed'; method: string; path: string; error: string }
  | { type: 'console' | 'page_error'; message: string };

export type RunResult =
  | { success: true; runId: RunIdentifier }
  | {
      success: false;
      runId: RunIdentifier;
      failedStep: number;
      action: BrowserStep['action'];
      reason: string;
      actualUrl?: string;
      relevantErrors: RelevantError[];
      artifacts?: { screenshot?: string; trace?: string };
    };

export interface RunMetrics {
  stepCount: number;
  durationMs: number;
  browserActionCount: number;
  failureCount: number;
  networkRequestCount: number;
  failedRequestCount: number;
  consoleMessageCount: number;
  consoleErrorCount: number;
  pageErrorCount: number;
  rawEvidenceEventCount: number;
  rawEvidenceBytes: number;
  reducedResponseBytes: number;
  artifactCount: number;
  compressionRatio: number;
}

export interface RunRecord {
  id: RunIdentifier;
  startedAt: string;
  endedAt: string;
  status: 'passed' | 'failed';
  metrics: RunMetrics;
  artifacts: ArtifactReference[];
}
