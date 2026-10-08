import type { BrowserStep, Evidence, FailureKind } from './protocol.js';

export const MAX_EXECUTED_STEPS = 360;
export const MAX_WORKFLOW_RETRIES = 60;
const readActions = new Set([
  'navigate',
  'wait_for',
  'hover',
  'extract_text',
  'extract_attribute',
]);

export function retryPolicyError(step: BrowserStep): string | undefined {
  if (step.action === 'branch') return;
  if (
    step.retry !== undefined &&
    !readActions.has(step.action) &&
    step.action !== 'click'
  )
    return 'Retry is supported only for navigation, waits, hover, extraction and pre-action clicks';
  if (
    step.recover &&
    (!['wait_for', 'extract_text', 'extract_attribute'].includes(step.action) ||
      step.retry !== 2)
  )
    return 'reloadOnce requires retry:2 on a wait or extraction';
  if (
    step.action === 'click' &&
    step.retry &&
    (step.dialog || step.expectPopup)
  )
    return 'Retry is incompatible with dialog or popup clicks';
}

/** Default GET navigation recovery is narrow; HTTP errors and uncertain effects stop replay. */
export function retryable(
  step: BrowserStep,
  kind: FailureKind,
  events: Evidence[],
): boolean {
  if (events.some((event) => event.type === 'http' && event.status >= 400))
    return false;
  if (step.action === 'click') return kind === 'target_not_ready';
  if (step.action === 'navigate' && step.retry === undefined)
    return kind === 'navigation_transient';
  return (
    readActions.has(step.action) &&
    ['timeout', 'element_not_found', 'navigation_transient'].includes(kind)
  );
}
