import { randomUUID } from 'node:crypto';
import type { BrowserAdapter } from './browser.js';
import { BridgeError } from './errors.js';
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

export interface ExecutionDependencies {
  browser: BrowserAdapter;
  runs: RunStore;
  artifacts: ArtifactStore;
  values: ValueResolver;
}

async function executeStep(
  step: BrowserStep,
  browser: BrowserAdapter,
  values: ValueResolver,
  evidence: EvidenceCollector,
): Promise<void> {
  const timeout = step.timeoutMs ?? 5000;
  switch (step.action) {
    case 'navigate':
      await browser.navigate(step.url, timeout);
      return;
    case 'click':
      await browser.click(step.target, timeout);
      return;
    case 'fill': {
      const value = values.resolve(step.valueRef);
      evidence.protect(value);
      await browser.fill(step.target, value, timeout);
      return;
    }
    case 'press':
      await browser.press(step.target, step.key, timeout);
      return;
    case 'wait_for':
      await browser.waitFor(step.target, timeout);
      return;
    case 'assert_url': {
      const actual = await browser.currentUrl();
      if (!actual.includes(step.contains))
        throw new BridgeError(
          'assertion',
          `Expected URL to contain ${step.contains}`,
        );
      return;
    }
    case 'assert_text': {
      const actual = await browser.text(step.target, timeout);
      if (!actual.includes(step.contains))
        throw new BridgeError(
          'assertion',
          `Expected text to contain ${step.contains}`,
        );
      return;
    }
    case 'assert_visible': {
      if (!(await browser.isVisible(step.target, timeout)))
        throw new BridgeError('assertion', 'Expected target to be visible');
      return;
    }
  }
}

function failureFor(
  error: unknown,
  action: BrowserStep['action'],
): NonNullable<StepResult['failure']> {
  if (error instanceof BridgeError)
    return { kind: error.kind, reason: error.message };
  if (error instanceof Error && error.name === 'TimeoutError')
    return { kind: 'timeout', reason: `Timed out during ${action}` };
  return {
    kind: action === 'navigate' ? 'navigation' : 'browser_execution',
    reason: `Browser operation failed during ${action}`,
  };
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
  const artifacts: ArtifactReference[] = [];
  let firstFailure: StepResult | undefined;
  const traceAllowed = !plan.steps.some((step) => step.action === 'fill');
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
  await deps.runs.prepare(runId);
  await deps.browser.start((event) => evidence.record(event), traceAllowed);
  try {
    const execute = async (
      step: BrowserStep,
      index: number,
    ): Promise<StepResult> => {
      evidence.setStep(index);
      const start = Date.now();
      let failure: StepResult['failure'];
      try {
        await executeStep(step, deps.browser, deps.values, evidence);
      } catch (error) {
        failure = failureFor(error, step.action);
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
  } finally {
    const reserved =
      firstFailure && traceAllowed
        ? await deps.artifacts.reservePath(runId, 'trace')
        : undefined;
    await deps.browser.stop(reserved?.path);
    if (reserved)
      artifacts.push(
        await deps.artifacts.register(
          runId,
          'trace',
          reserved.id,
          reserved.path,
        ),
      );
  }

  const screenshot = artifacts.find(
    (artifact) => artifact.type === 'screenshot',
  );
  const trace = artifacts.find((artifact) => artifact.type === 'trace');
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
        ...(artifacts.length
          ? {
              artifacts: {
                ...(screenshot ? { screenshot: screenshot.id } : {}),
                ...(trace ? { trace: trace.id } : {}),
              },
            }
          : {}),
      }
    : { success: true, runId };
  const endedAt = Date.now();
  const responseBytes = Buffer.byteLength(JSON.stringify(result));
  const record: RunRecord = {
    id: runId,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    status: result.success ? 'passed' : 'failed',
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
  await deps.runs.save(record, plan, steps, evidence.events, result);
  return result;
}
