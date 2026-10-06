import { z } from 'zod';
import type { SessionFinding, SessionMetrics } from './session.js';

export const MAX_WORKFLOW_STEPS = 300;
export const DEFAULT_WORKFLOW_TIMEOUT_MS = 180_000;

const nonEmpty = z.string().min(1);
const valueName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const httpUrl = z
  .url()
  .refine((value) => /^https?:\/\//.test(value), 'Expected an HTTP(S) URL')
  .refine((value) => {
    try {
      const url = new URL(value);
      return !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'URL credentials are not allowed');
const targetSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('role'),
      role: nonEmpty,
      name: nonEmpty.optional(),
    }),
    z.strictObject({ kind: z.literal('label'), label: nonEmpty }),
    z.strictObject({ kind: z.literal('text'), text: nonEmpty }),
    z.strictObject({ kind: z.literal('testId'), testId: nonEmpty }),
    z.strictObject({ kind: z.literal('css'), selector: nonEmpty }),
  ])
  .meta({ id: 'BrowserTarget' });

const options = {
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  continueOnFailure: z.boolean().optional(),
};

export const BrowserOptionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('value'), value: nonEmpty }),
  z.strictObject({ kind: z.literal('label'), label: nonEmpty }),
  z.strictObject({ kind: z.literal('index'), index: z.number().int().min(0) }),
]);
export type BrowserOption = z.infer<typeof BrowserOptionSchema>;

const extraction = {
  target: targetSchema,
  saveAs: valueName,
  maxChars: z.number().int().min(1).max(1000).optional(),
};
const dialogExpectation = z.strictObject({
  type: z.enum(['alert', 'confirm', 'prompt']),
  action: z.enum(['accept', 'dismiss']),
  valueRef: valueName.optional(),
});
export type DialogExpectation = z.infer<typeof dialogExpectation>;

export const BrowserTargetSchema = targetSchema;
export type BrowserTarget = z.infer<typeof BrowserTargetSchema>;

export const BrowserStepSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('navigate'), url: httpUrl, ...options }),
  z.strictObject({
    action: z.literal('click'),
    target: targetSchema,
    dialog: dialogExpectation.optional(),
    expectPopup: z.boolean().optional(),
    ...options,
  }),
  z.strictObject({
    action: z.literal('fill'),
    target: targetSchema,
    valueRef: valueName,
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
  z.strictObject({
    action: z.literal('select_option'),
    target: targetSchema,
    option: BrowserOptionSchema,
    ...options,
  }),
  z.strictObject({
    action: z.literal('check'),
    target: targetSchema,
    ...options,
  }),
  z.strictObject({
    action: z.literal('uncheck'),
    target: targetSchema,
    ...options,
  }),
  z.strictObject({
    action: z.literal('hover'),
    target: targetSchema,
    ...options,
  }),
  z.strictObject({
    action: z.literal('extract_text'),
    ...extraction,
    ...options,
  }),
  z.strictObject({
    action: z.literal('extract_attribute'),
    ...extraction,
    attribute: z.string().regex(/^[A-Za-z_:][A-Za-z0-9_:.-]*$/),
    ...options,
  }),
  z.strictObject({
    action: z.literal('upload_file'),
    target: targetSchema,
    fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    ...options,
  }),
  z.strictObject({
    action: z.literal('expect_download'),
    target: targetSchema,
    ...options,
  }),
]);
export type BrowserStep = z.infer<typeof BrowserStepSchema>;

export const BrowserPlanSchema = z
  .strictObject({
    startUrl: httpUrl,
    steps: z.array(BrowserStepSchema).min(1).max(MAX_WORKFLOW_STEPS),
    outputs: z.array(valueName).max(5).optional(),
    timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  })
  .superRefine((plan, context) => {
    const names = new Map<string, number>();
    for (const [index, step] of plan.steps.entries()) {
      if (step.action !== 'extract_text' && step.action !== 'extract_attribute')
        continue;
      if (names.has(step.saveAs))
        context.addIssue({
          code: 'custom',
          path: ['steps', index, 'saveAs'],
          message: `Duplicate extraction name ${step.saveAs}`,
        });
      names.set(step.saveAs, step.maxChars ?? 200);
    }
    for (const name of plan.outputs ?? []) {
      if (!names.has(name))
        context.addIssue({
          code: 'custom',
          path: ['outputs'],
          message: `Unknown extraction ${name}`,
        });
    }
    if (new Set(plan.outputs ?? []).size !== (plan.outputs ?? []).length)
      context.addIssue({
        code: 'custom',
        path: ['outputs'],
        message: 'Duplicate output name',
      });
    if (
      (plan.outputs ?? []).reduce(
        (sum, name) => sum + (names.get(name) ?? 0),
        0,
      ) > 2000
    )
      context.addIssue({
        code: 'custom',
        path: ['outputs'],
        message: 'Output character budget exceeds 2000',
      });
  });
export type BrowserPlan = z.infer<typeof BrowserPlanSchema>;

export type RunIdentifier = string;
export type ArtifactType =
  'screenshot' | 'trace' | 'download' | 'browser_storage_state';
export interface ArtifactReference {
  id: string;
  runId: RunIdentifier;
  type: ArtifactType;
  path: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  fileName?: string;
  sensitive?: boolean;
  inlineRetrievalAllowed?: boolean;
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
  | { type: 'navigation'; at: number; stepIndex: number | null; url: string }
  | {
      type: 'dialog';
      at: number;
      stepIndex: number | null;
      dialogType: string;
      expected: boolean;
    }
  | {
      type: 'popup';
      at: number;
      stepIndex: number | null;
      url: string;
      expected: boolean;
    };

export type FailureKind =
  | 'element_not_found'
  | 'timeout'
  | 'assertion'
  | 'navigation'
  | 'secret_resolution'
  | 'cancelled'
  | 'browser_execution';
export interface StepResult {
  index: number;
  action: BrowserStep['action'];
  status: 'passed' | 'failed';
  startedAt: number;
  endedAt: number;
  durationMs: number;
  actualUrl?: string;
  actualText?: string;
  failure?: { kind: FailureKind; reason: string };
}

export type RelevantError =
  | { type: 'http'; method: string; path: string; status: number }
  | { type: 'request_failed'; method: string; path: string; error: string }
  | { type: 'console' | 'page_error' | 'dialog' | 'popup'; message: string };

export type RunResult =
  | {
      success: true;
      runId: RunIdentifier;
      outputs?: Record<string, string>;
      downloads?: string[];
    }
  | {
      success: false;
      runId: RunIdentifier;
      failedStep: number;
      action: BrowserStep['action'];
      reason: string;
      actualUrl?: string;
      relevantErrors: RelevantError[];
      outputs?: Record<string, string>;
      actualText?: string;
      artifacts?: { screenshot?: string; trace?: string };
      session?: { findings: SessionFinding[] };
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
  session?: SessionMetrics;
}

export interface RunRecord {
  id: RunIdentifier;
  startedAt: string;
  endedAt: string;
  status: 'passed' | 'failed' | 'aborted';
  metrics: RunMetrics;
  artifacts: ArtifactReference[];
}
