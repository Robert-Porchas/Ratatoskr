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

export interface ExecutionDependencies {
  browser: BrowserAdapter;
  runs: RunStore;
  artifacts: ArtifactStore;
  values: ValueResolver;
  uploads?: UploadResolver;
  signal?: AbortSignal;
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
    case 'navigate':
      await browser.navigate(step.url, timeout);
      return;
    case 'click': {
      const dialogValue = step.dialog?.valueRef
        ? values.resolve(step.dialog.valueRef)
        : undefined;
      if (dialogValue) evidence.protect(dialogValue);
      await browser.click(step.target, timeout, {
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
      const value = values.resolve(step.valueRef);
      evidence.protect(value);
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
      return evidence
        .redact(await browser.text(step.target, timeout))
        .slice(0, step.maxChars ?? 200);
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
      return evidence.redact(value).slice(0, step.maxChars ?? 200);
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
  const runId = `run_${randomUUID().replaceAll('-', '')}`;
  const startedAt = Date.now();
  const evidence = new EvidenceCollector();
  const steps: StepResult[] = [];
  const extractions: Record<string, string> = {};
  const artifacts: ArtifactReference[] = [];
  let firstFailure: StepResult | undefined;
  let browserStarted = false;
  const traceAllowed = !plan.steps.some(
    (step) =>
      step.action === 'fill' ||
      step.action === 'upload_file' ||
      (step.action === 'click' && Boolean(step.dialog?.valueRef)),
  );
  const deadline = startedAt + (plan.timeoutMs ?? 120_000);
  const captureFailure = async (): Promise<void> => {
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
    await deps.browser.start((event) => evidence.record(event), traceAllowed);
    browserStarted = true;
    if (deps.signal?.aborted)
      throw new RatatoskrError('cancelled', 'Browser workflow was cancelled');
    const execute = async (
      step: BrowserStep,
      index: number,
    ): Promise<StepResult> => {
      evidence.setStep(index);
      const start = Date.now();
      let failure: StepResult['failure'];
      try {
        if (deps.signal?.aborted)
          throw new RatatoskrError(
            'cancelled',
            'Browser workflow was cancelled',
          );
        const remaining = deadline - start;
        if (remaining <= 0) throw new StepTimeoutError(step.action);
        const value = await executeStep(
          step,
          deps.browser,
          deps.values,
          evidence,
          Math.min(step.timeoutMs ?? 5000, remaining),
          runId,
          deps.artifacts,
          artifacts,
          deps.uploads,
        );
        if (
          value !== undefined &&
          (step.action === 'extract_text' ||
            step.action === 'extract_attribute')
        )
          extractions[step.saveAs] = value;
      } catch (error) {
        failure = failureFor(error, step.action, deps.signal?.aborted);
      }
      let actualText: string | undefined;
      if (failure && step.action === 'assert_text' && !deps.signal?.aborted) {
        try {
          actualText = evidence
            .redact(
              await deps.browser.text(
                step.target,
                Math.min(250, Math.max(1, deadline - Date.now())),
              ),
            )
            .slice(0, 200);
        } catch {
          /* Missing targets carry no fabricated text. */
        }
      }
      const end = Date.now();
      let actualUrl: string | undefined;
      try {
        actualUrl = evidence.redact(await deps.browser.currentUrl());
      } catch {
        /* browser may have closed */
      }
      evidence.setStep(null);
      return {
        index,
        action: step.action,
        status: failure ? 'failed' : 'passed',
        startedAt: start,
        endedAt: end,
        durationMs: end - start,
        ...(actualUrl ? { actualUrl } : {}),
        ...(actualText !== undefined ? { actualText } : {}),
        ...(failure ? { failure } : {}),
      };
    };

    const initial = await execute(
      { action: 'navigate', url: plan.startUrl },
      -1,
    );
    if (initial.status === 'failed') {
      firstFailure = initial;
      await captureFailure();
    } else {
      for (const [index, step] of plan.steps.entries()) {
        const result = await execute(step, index);
        steps.push(result);
        if (result.status === 'failed') {
          if (!firstFailure) {
            firstFailure = result;
            await captureFailure();
          }
          if (!step.continueOnFailure) break;
        }
      }
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
    deps.signal?.removeEventListener('abort', onAbort);
    let reserved: { id: string; path: string } | undefined;
    try {
      if (
        firstFailure &&
        traceAllowed &&
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
        ...(firstFailure.actualUrl
          ? { actualUrl: firstFailure.actualUrl }
          : {}),
        relevantErrors: relevantErrors(evidence.events, firstFailure),
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
      plan.steps.length,
      steps,
      evidence.events,
      endedAt - startedAt,
      responseBytes,
      artifacts.length,
      firstFailure?.index === -1,
    ),
    artifacts,
  };
  await deps.runs.save(
    record,
    plan,
    steps,
    evidence.events,
    result,
    extractions,
  );
  return result;
}
