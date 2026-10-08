import { randomUUID } from 'node:crypto';
import type { BrowserAdapter } from './browser.js';
import {
  RatatoskrError,
  BrowserAssertionError,
  BrowserExecutionError,
  ElementNotFoundError,
  NavigationError,
  StepTimeoutError,
} from './errors.js';
import { EvidenceCollector, buildMetrics, relevantErrors } from './evidence.js';
import {
  DEFAULT_WORKFLOW_TIMEOUT_MS,
  BrowserPlanSchema,
  BrowserTargetSchema,
  BrowserOptionSchema,
  WorkflowConditionSchema,
  HttpUrlSchema,
} from './protocol.js';
import {
  retryable,
  MAX_EXECUTED_STEPS,
  MAX_WORKFLOW_RETRIES,
} from './workflow-retry.js';
import { flattenSteps } from './workflow-structure.js';
import { interpolateStep } from './workflow-variables.js';
import type {
  BrowserPlan,
  BrowserStep,
  RunRecord,
  RunResult,
  StepResult,
  ArtifactReference,
} from './protocol.js';
import type { ArtifactStore, RunStore } from './storage.js';
import type { ValueResolver } from './values.js';
import type { UploadResolver } from './uploads.js';
import {
  SessionJournal,
  reduceSession,
  sanitizeSessionRecord,
  type SessionRecord,
} from './session.js';

// Keep complete text until final redaction, but never retain an unbounded DOM
// string or truncate a still-unknown credential into an unrecognizable prefix.
const MAX_EPHEMERAL_TEXT_CHARS = 16_384;
function boundedExtraction(value: string): string {
  if (value.length > MAX_EPHEMERAL_TEXT_CHARS)
    throw new RatatoskrError(
      'browser_execution',
      'Extraction target exceeds the local text capture limit',
    );
  return value;
}

export interface ExecutionDependencies {
  browser: BrowserAdapter;
  runs: RunStore;
  artifacts: ArtifactStore;
  values: ValueResolver;
  uploads?: UploadResolver;
  signal?: AbortSignal;
  sessionDiagnostics?: boolean;
  captureAuthState?: boolean;
}

async function executeStep(
  step: BrowserStep,
  browser: BrowserAdapter,
  values: ValueResolver,
  evidence: EvidenceCollector,
  timeout: number,
  runId: string,
  artifacts: ArtifactStore,
  createdArtifacts: ArtifactReference[],
  uploads: UploadResolver | undefined,
): Promise<string | undefined> {
  switch (step.action) {
    case 'branch':
      return;
    case 'navigate':
      await browser.navigate(step.url, timeout);
      return;
    case 'click': {
      const dialogValue = step.dialog?.valueRef
        ? values.resolve(step.dialog.valueRef)
        : undefined;
      if (dialogValue) evidence.protect(dialogValue);
      await browser.click(step.target, timeout, {
        ...(step.retry && step.retry > 1 ? { safeRetry: true } : {}),
        ...(step.expectPopup ? { expectPopup: true } : {}),
        ...(step.dialog
          ? {
              dialog: {
                ...step.dialog,
                ...(dialogValue ? { value: dialogValue } : {}),
              },
            }
          : {}),
      });
      return;
    }
    case 'fill': {
      const value = step.valueRef ? values.resolve(step.valueRef) : step.value!;
      if (step.valueRef) evidence.protect(value);
      await browser.fill(step.target, value, timeout);
      return;
    }
    case 'press':
      await browser.press(step.target, step.key, timeout);
      return;
    case 'select_option':
      await browser.selectOption(step.target, step.option, timeout);
      return;
    case 'check':
      await browser.setChecked(step.target, true, timeout);
      return;
    case 'uncheck':
      await browser.setChecked(step.target, false, timeout);
      return;
    case 'hover':
      await browser.hover(step.target, timeout);
      return;
    case 'upload_file':
      if (!uploads)
        throw new RatatoskrError(
          'browser_execution',
          'Upload directory is not configured',
        );
      await browser.upload(
        step.target,
        await uploads.resolve(step.fileName),
        timeout,
      );
      return;
    case 'expect_download': {
      const reserved = await artifacts.reservePath(runId, 'download');
      try {
        const details = await browser.download(
          step.target,
          reserved.path,
          timeout,
        );
        createdArtifacts.push(
          await artifacts.register(
            runId,
            'download',
            reserved.id,
            reserved.path,
            details,
          ),
        );
      } catch (error) {
        await artifacts.discard(runId, 'download', reserved.id);
        throw error;
      }
      return;
    }
    case 'wait_for':
      await browser.waitFor(step.target, timeout);
      return;
    case 'assert_url': {
      try {
        await browser.waitForUrlContains(step.contains, timeout);
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError')
          throw new BrowserAssertionError(
            `Expected URL to contain ${step.contains}`,
          );
        throw error;
      }
      return;
    }
    case 'assert_text': {
      try {
        await browser.waitForTextContains(step.target, step.contains, timeout);
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError')
          throw new BrowserAssertionError(
            `Expected text to contain ${step.contains}`,
          );
        throw error;
      }
      return;
    }
    case 'assert_visible': {
      if (!(await browser.isVisible(step.target, timeout)))
        throw new BrowserAssertionError('Expected target to be visible');
      return;
    }
    case 'extract_text':
      return boundedExtraction(await browser.text(step.target, timeout));
    case 'extract_attribute': {
      const value = await browser.attribute(
        step.target,
        step.attribute,
        timeout,
      );
      if (value === null)
        throw new BrowserAssertionError(
          `Attribute ${step.attribute} was not present`,
        );
      return boundedExtraction(value);
    }
  }
}

function failureFor(
  error: unknown,
  action: BrowserStep['action'],
  aborted = false,
): NonNullable<StepResult['failure']> {
  if (aborted)
    return { kind: 'cancelled', reason: 'Browser workflow was cancelled' };
  if (error instanceof RatatoskrError)
    return { kind: error.kind, reason: error.message };
  if (error instanceof Error && error.name === 'TimeoutError') {
    const classified =
      action === 'wait_for'
        ? new ElementNotFoundError()
        : new StepTimeoutError(action);
    return { kind: classified.kind, reason: classified.message };
  }
  const classified =
    action === 'navigate'
      ? new NavigationError()
      : new BrowserExecutionError(action);
  return { kind: classified.kind, reason: classified.message };
}

/** Execute a validated plan. Returned results contain only reduced evidence. */
export async function executePlan(
  plan: BrowserPlan,
  deps: ExecutionDependencies,
): Promise<RunResult> {
  plan = BrowserPlanSchema.parse(plan);
  const flatSteps = flattenSteps(plan.steps);
  let executed = 0,
    retries = 0;
  const indexes = new Map(flatSteps.map((step, index) => [step, index]));
  const variables = new Map(Object.entries(plan.parameters ?? {}));
  const runId = `run_${randomUUID().replaceAll('-', '')}`;
  const startedAt = Date.now();
  const evidence = new EvidenceCollector();
  const session = new SessionJournal();
  let failureSession: SessionRecord | undefined;
  const captureSession = async (
    full: boolean,
    stepIndex: number | null,
  ): Promise<void> => {
    if (!deps.browser.sessionSnapshot || deps.signal?.aborted) return;
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const snapshot = await Promise.race([
        deps.browser.sessionSnapshot(full, { at: Date.now(), stepIndex }),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), 1000);
        }),
      ]);
      if (snapshot) session.add(snapshot);
      else session.record.truncated = true;
    } catch {
      session.record.truncated = true;
    } finally {
      if (timer) clearTimeout(timer);
      session.metrics.captureDurationMs += performance.now() - started;
    }
  };
  const steps: StepResult[] = [];
  const extractions = Object.create(null) as Record<string, string>;
  const artifacts: ArtifactReference[] = [];
  let firstFailure: StepResult | undefined;
  let initialNavigation: StepResult | undefined;
  let browserStarted = false;
  const traceAllowed = !flatSteps.some(
    (step) =>
      step.action === 'fill' ||
      step.action === 'upload_file' ||
      (step.action === 'click' && Boolean(step.dialog?.valueRef)),
  );
  const deadline = startedAt + (plan.timeoutMs ?? DEFAULT_WORKFLOW_TIMEOUT_MS);
  const withinBudget = async <T>(work: () => Promise<T>): Promise<T> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new RatatoskrError('budget_exhausted', 'WORKFLOW_BUDGET_EXHAUSTED');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            void deps.browser.stop().catch(() => undefined);
            reject(
              new RatatoskrError(
                'budget_exhausted',
                'WORKFLOW_BUDGET_EXHAUSTED',
              ),
            );
          }, remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const captureFailure = async (): Promise<void> => {
    await captureSession(true, firstFailure?.index ?? null);
    failureSession = sanitizeSessionRecord(session.record, (value) =>
      evidence.redact(value),
    );
    if (
      deps.captureAuthState &&
      firstFailure &&
      deps.browser.authenticationState &&
      reduceSession(
        failureSession,
        { ...firstFailure, endedAt: Date.now() },
        evidence.events,
      )
    ) {
      let stateTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const state = await Promise.race([
          deps.browser.authenticationState(),
          new Promise<undefined>((resolve) => {
            stateTimer = setTimeout(() => resolve(undefined), 1000);
          }),
        ]);
        if (state) {
          artifacts.push(
            await deps.artifacts.save(runId, 'browser_storage_state', state),
          );
          session.metrics.sensitiveArtifactsCreated++;
        } else session.record.truncated = true;
      } catch {
        /* Protected state capture is opt-in and best effort. */
      } finally {
        if (stateTimer) clearTimeout(stateTimer);
      }
    }
    try {
      artifacts.push(
        await deps.artifacts.save(
          runId,
          'screenshot',
          await deps.browser.screenshot(),
        ),
      );
    } catch {
      // A screenshot is best effort when a page has crashed.
    }
  };
  const onAbort = (): void => {
    if (browserStarted) void deps.browser.stop().catch(() => undefined);
  };
  await deps.runs.prepare(runId);
  deps.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (deps.signal?.aborted)
      throw new RatatoskrError('cancelled', 'Browser workflow was cancelled');
    await withinBudget(async () => {
      await deps.browser.start(
        (event) => evidence.record(event),
        traceAllowed,
        {
          protect: (value) => evidence.protect(value),
          fingerprint: (value) => session.fingerprint(value),
          response: (response) => session.response(response),
        },
      );
      if (deps.signal?.aborted || Date.now() >= deadline) {
        await deps.browser.stop().catch(() => undefined);
        throw new RatatoskrError(
          deps.signal?.aborted ? 'cancelled' : 'budget_exhausted',
          deps.signal?.aborted
            ? 'Browser workflow was cancelled'
            : 'WORKFLOW_BUDGET_EXHAUSTED',
        );
      }
      browserStarted = true;
    });
    await captureSession(true, -1);
    if (deps.signal?.aborted)
      throw new RatatoskrError('cancelled', 'Browser workflow was cancelled');
    const execute = async (
      template: BrowserStep,
      index: number,
    ): Promise<StepResult> => {
      let step = template;
      evidence.setStep(index);
      deps.browser.setSessionStep?.(index);
      const start = Date.now();
      let failure: StepResult['failure'];
      let branch: boolean | undefined;
      let attempts = 0;
      const trace: NonNullable<StepResult['trace']> = [];
      try {
        if (deps.signal?.aborted)
          throw new RatatoskrError(
            'cancelled',
            'Browser workflow was cancelled',
          );
        step = interpolateStep(template, variables);
        if (
          (step.action === 'select_option' &&
            !BrowserOptionSchema.safeParse(step.option).success) ||
          (step.action === 'branch' &&
            !WorkflowConditionSchema.safeParse(step.condition).success)
        )
          throw new RatatoskrError(
            'invalid_variable',
            'Interpolated option or condition is invalid',
          );
        const target =
          'target' in step
            ? step.target
            : step.action === 'branch' && step.condition.kind === 'visible'
              ? step.condition.target
              : undefined;
        if (target && !BrowserTargetSchema.safeParse(target).success)
          throw new RatatoskrError(
            'invalid_variable',
            'Interpolated target is invalid',
          );
        if ('contains' in step && !step.contains.length)
          throw new RatatoskrError(
            'invalid_variable',
            'Interpolated assertion cannot be empty',
          );
        if (
          step.action === 'navigate' &&
          !HttpUrlSchema.safeParse(step.url).success
        )
          throw new RatatoskrError(
            'invalid_variable',
            'Interpolated URL must be credential-free HTTP(S)',
          );
        const remaining = deadline - start;
        if (remaining <= 0)
          throw new RatatoskrError(
            'budget_exhausted',
            'WORKFLOW_BUDGET_EXHAUSTED',
          );
        if (++executed > MAX_EXECUTED_STEPS)
          throw new RatatoskrError(
            'budget_exhausted',
            'WORKFLOW_BUDGET_EXHAUSTED',
          );
        if (step.action === 'branch') {
          const condition = step.condition;
          const answer =
            condition.kind === 'visible'
              ? await withinBudget(() =>
                  deps.browser.isVisible(
                    condition.target,
                    Math.min(250, remaining),
                  ),
                )
              : condition.kind === 'url_contains'
                ? (
                    await withinBudget(() => deps.browser.currentUrl())
                  ).includes(condition.contains)
                : condition.kind === 'variable_exists'
                  ? variables.has(condition.variable)
                  : variables.get(condition.variable) === condition.equals;
          branch = condition.not ? !answer : answer;
        }
        let value: string | undefined;
        const totalAttempts =
          step.action === 'branch'
            ? 1
            : (step.retry ?? (step.action === 'navigate' ? 2 : 1));
        while (attempts < totalAttempts) {
          attempts++;
          if (totalAttempts > 1)
            trace.push({ at: Date.now(), event: 'attempt' });
          try {
            value = await withinBudget(() =>
              executeStep(
                step,
                deps.browser,
                deps.values,
                evidence,
                Math.min(
                  step.timeoutMs ?? 5000,
                  Math.max(1, deadline - Date.now()),
                ),
                runId,
                deps.artifacts,
                artifacts,
                deps.uploads,
              ),
            );
            break;
          } catch (error) {
            const classified = failureFor(
              error,
              step.action,
              deps.signal?.aborted,
            );
            if (
              attempts >= totalAttempts ||
              !retryable(step, classified.kind, evidence.events)
            )
              throw error;
            if (
              ++retries > MAX_WORKFLOW_RETRIES ||
              ++executed > MAX_EXECUTED_STEPS
            )
              throw new RatatoskrError(
                'budget_exhausted',
                'WORKFLOW_BUDGET_EXHAUSTED',
              );
            trace.push({
              at: Date.now(),
              event: 'retry',
              reason: classified.kind,
            });
            if (step.action !== 'branch' && step.recover === 'reloadOnce') {
              if (++executed > MAX_EXECUTED_STEPS)
                throw new RatatoskrError(
                  'budget_exhausted',
                  'WORKFLOW_BUDGET_EXHAUSTED',
                );
              if (!deps.browser.reload)
                throw new RatatoskrError(
                  'browser_execution',
                  'Reload recovery is unavailable',
                );
              trace.push({ at: Date.now(), event: 'recovery' });
              await withinBudget(() =>
                deps.browser.reload!(
                  Math.min(5000, Math.max(1, deadline - Date.now())),
                ),
              );
              await captureSession(false, index);
            } else
              await withinBudget(
                () =>
                  new Promise<void>((resolve) =>
                    setTimeout(resolve, 250 * attempts),
                  ),
              );
          }
        }
        if (
          value !== undefined &&
          (step.action === 'extract_text' ||
            step.action === 'extract_attribute')
        ) {
          if (value.length > 1000)
            throw new RatatoskrError(
              'invalid_variable',
              'Variable exceeds 1000 characters',
            );
          extractions[step.saveAs] = value;
          variables.set(step.saveAs, value);
          trace.push({ at: Date.now(), event: 'variable', name: step.saveAs });
        }
      } catch (error) {
        failure = failureFor(error, step.action, deps.signal?.aborted);
      }
      let actualText: string | undefined;
      if (
        failure?.kind === 'timeout' &&
        step.action === 'click' &&
        deps.browser.targetExists &&
        !deps.signal?.aborted
      ) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const exists = await Promise.race([
            deps.browser.targetExists(step.target),
            new Promise<undefined>((resolve) => {
              timer = setTimeout(
                () => resolve(undefined),
                Math.min(150, Math.max(1, deadline - Date.now())),
              );
            }),
          ]);
          if (exists === false) {
            const description =
              step.target.kind === 'role'
                ? `${step.target.role} ${step.target.name ?? ''}`.trim()
                : step.target.kind;
            failure = {
              kind: 'element_not_found',
              reason: evidence
                .redact(`Click target not found: ${description}`)
                .slice(0, 160),
            };
          }
        } catch {
          /* A failed diagnostic probe must not replace the original failure. */
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      if (failure && step.action === 'assert_text' && !deps.signal?.aborted) {
        try {
          actualText = await deps.browser.text(
            step.target,
            Math.min(250, Math.max(1, deadline - Date.now())),
          );
          if (actualText.length > MAX_EPHEMERAL_TEXT_CHARS)
            actualText = undefined;
        } catch {
          /* Missing targets carry no fabricated text. */
        }
      }
      if (
        ['navigate', 'click', 'press', 'expect_download'].includes(step.action)
      )
        await captureSession(index === -1, index);
      const end = Date.now();
      let actualUrl: string | undefined;
      try {
        actualUrl = evidence.redact(await deps.browser.currentUrl());
      } catch (error) {
        // A late popup/dialog event can arrive after click has resolved.
        if (error instanceof RatatoskrError && !failure)
          failure = failureFor(error, step.action);
      }
      evidence.setStep(null);
      deps.browser.setSessionStep?.(null);
      return {
        index,
        action: step.action,
        status: failure ? 'failed' : 'passed',
        startedAt: start,
        endedAt: end,
        durationMs: end - start,
        ...(attempts > 1 ? { attempts } : {}),
        ...(trace.length ? { trace } : {}),
        ...(branch !== undefined ? { branch } : {}),
        ...(actualUrl ? { actualUrl } : {}),
        ...(actualText !== undefined ? { actualText } : {}),
        ...(failure ? { failure } : {}),
      };
    };

    const initial = await execute(
      { action: 'navigate', url: plan.startUrl },
      -1,
    );
    initialNavigation = initial;
    if (initial.status === 'failed') {
      firstFailure = initial;
      await captureFailure();
    } else {
      const walk = async (items: BrowserStep[]): Promise<boolean> => {
        for (const step of items) {
          const result = await execute(step, indexes.get(step)!);
          steps.push(result);
          if (result.status === 'failed') {
            if (!firstFailure) {
              firstFailure = result;
              await captureFailure();
            }
            if (!step.continueOnFailure) return false;
          } else if (
            step.action === 'branch' &&
            !(await walk(result.branch ? step.then : (step.else ?? [])))
          )
            return false;
        }
        return true;
      };
      await walk(plan.steps);
    }
    if (deps.signal?.aborted && !firstFailure)
      throw new RatatoskrError('cancelled', 'Browser workflow was cancelled');
  } catch (error) {
    if (!firstFailure) {
      const now = Date.now();
      firstFailure = {
        index: -1,
        action: 'navigate',
        status: 'failed',
        startedAt,
        endedAt: now,
        durationMs: now - startedAt,
        failure: failureFor(error, 'navigate', deps.signal?.aborted),
      };
      if (browserStarted && !deps.signal?.aborted) await captureFailure();
    }
  } finally {
    if (browserStarted && !deps.signal?.aborted)
      await captureSession(true, firstFailure?.index ?? null);
    deps.signal?.removeEventListener('abort', onAbort);
    let reserved: { id: string; path: string } | undefined;
    try {
      if (
        firstFailure &&
        traceAllowed &&
        !deps.browser.hasSensitiveSession?.() &&
        browserStarted &&
        !deps.signal?.aborted
      )
        reserved = await deps.artifacts.reservePath(runId, 'trace');
      if (browserStarted) await deps.browser.stop(reserved?.path);
      if (reserved)
        artifacts.push(
          await deps.artifacts.register(
            runId,
            'trace',
            reserved.id,
            reserved.path,
          ),
        );
    } catch {
      if (browserStarted) await deps.browser.stop().catch(() => undefined);
      if (reserved)
        await deps.artifacts
          .discard(runId, 'trace', reserved.id)
          .catch(() => undefined);
    }
  }

  const sanitizeStep = (step: StepResult): StepResult => {
    const safe = evidence.sanitize(step);
    if (safe.actualText !== undefined)
      safe.actualText = safe.actualText.slice(0, 200);
    return safe;
  };
  for (let index = 0; index < steps.length; index++)
    steps[index] = sanitizeStep(steps[index]!);
  for (const step of flatSteps) {
    if (
      (step.action === 'extract_text' || step.action === 'extract_attribute') &&
      Object.hasOwn(extractions, step.saveAs)
    )
      extractions[step.saveAs] = evidence
        .redact(extractions[step.saveAs]!)
        .slice(0, step.maxChars ?? 200);
  }
  if (firstFailure) firstFailure = sanitizeStep(firstFailure);
  const sessionRecord = sanitizeSessionRecord(session.record, (value) =>
    evidence.redact(value),
  );
  const sessionDiagnosis =
    firstFailure && deps.sessionDiagnostics !== false
      ? reduceSession(
          failureSession
            ? sanitizeSessionRecord(failureSession, (value) =>
                evidence.redact(value),
              )
            : sessionRecord,
          { ...firstFailure, endedAt: firstFailure.endedAt + 1000 },
          evidence.events,
        )
      : undefined;
  session.metrics.sessionFindingsReturned =
    sessionDiagnosis?.findings.length ?? 0;
  session.metrics.sessionFindingBytes = sessionDiagnosis
    ? Buffer.byteLength(JSON.stringify(sessionDiagnosis))
    : 0;
  session.metrics.rawLocalSessionEvidenceBytes = Buffer.byteLength(
    JSON.stringify(sessionRecord),
  );

  const screenshot = artifacts.find(
    (artifact) => artifact.type === 'screenshot',
  );
  const trace = artifacts.find((artifact) => artifact.type === 'trace');
  const requestedOutputs = Object.fromEntries(
    (plan.outputs ?? [])
      .filter((name) => Object.hasOwn(extractions, name))
      .map((name) => [name, extractions[name]!]),
  );
  const result: RunResult = firstFailure
    ? {
        success: false,
        runId,
        failedStep: firstFailure.index,
        action: firstFailure.action,
        reason: firstFailure.failure?.reason ?? 'Step failed',
        ...(firstFailure.attempts ? { attempts: firstFailure.attempts } : {}),
        ...([
          'side_effect_state_unknown',
          'budget_exhausted',
          'undefined_variable',
          'invalid_variable',
        ].includes(firstFailure.failure?.kind ?? '')
          ? { code: firstFailure.failure!.kind }
          : {}),
        ...(firstFailure.actualUrl
          ? { actualUrl: firstFailure.actualUrl }
          : {}),
        relevantErrors: relevantErrors(evidence.events, firstFailure),
        ...(sessionDiagnosis ? { session: sessionDiagnosis } : {}),
        ...(firstFailure.actualText !== undefined
          ? { actualText: firstFailure.actualText }
          : {}),
        ...(Object.keys(requestedOutputs).length
          ? { outputs: requestedOutputs }
          : {}),
        ...(artifacts.length
          ? {
              artifacts: {
                ...(screenshot ? { screenshot: screenshot.id } : {}),
                ...(trace ? { trace: trace.id } : {}),
              },
            }
          : {}),
      }
    : {
        success: true,
        runId,
        ...(Object.keys(requestedOutputs).length
          ? { outputs: requestedOutputs }
          : {}),
        ...(artifacts.some((artifact) => artifact.type === 'download')
          ? {
              downloads: artifacts
                .filter((artifact) => artifact.type === 'download')
                .map((artifact) => artifact.id),
            }
          : {}),
      };
  const endedAt = Date.now();
  const responseBytes = Buffer.byteLength(JSON.stringify(result));
  const record: RunRecord = {
    id: runId,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    status: result.success
      ? 'passed'
      : deps.signal?.aborted
        ? 'aborted'
        : 'failed',
    metrics: buildMetrics(
      flatSteps.length,
      steps,
      evidence.events,
      endedAt - startedAt,
      responseBytes,
      artifacts.length,
      firstFailure?.index === -1,
    ),
    artifacts,
    ...(initialNavigation?.attempts && initialNavigation.attempts > 1
      ? { initialNavigation: sanitizeStep(initialNavigation) }
      : {}),
  };
  record.metrics.browserActionCount += (initialNavigation?.attempts ?? 1) - 1;
  if (deps.browser.sessionSnapshot) record.metrics.session = session.metrics;
  await deps.runs.save(
    record,
    evidence.sanitize(plan),
    steps,
    evidence.events,
    result,
    extractions,
    deps.browser.sessionSnapshot ? sessionRecord : undefined,
  );
  return result;
}
