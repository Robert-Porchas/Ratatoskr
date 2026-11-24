import {
  BrowserPlanSchema,
  DEFAULT_WORKFLOW_TIMEOUT_MS,
  HttpUrlSchema,
  type BrowserPlan,
  type BrowserTarget,
} from './protocol.js';
import { flattenSteps } from './workflow-structure.js';

export const MAX_EXPORTED_SOURCE_BYTES = 64_000;

export interface WorkflowExportOptions {
  testName?: string;
  /** Fallback when neither RATATOSKR_BASE_URL nor Playwright baseURL is set. */
  baseURL?: string;
}

export interface WorkflowExportResult {
  ready: boolean;
  source?: string;
  warnings: string[];
  unsupported: Array<{ stepIndex: number; action: string; reason: string }>;
  unsupportedCount: number;
  assertionCount: number;
  requiredEnvironment: string[];
}

// JSON string literals cannot interpolate or terminate generated statements.
const quote = (value: string): string =>
  JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/** Pure, strict translation. Unsupported semantics never yield runnable source. */
export function exportWorkflow(
  input: BrowserPlan,
  options: WorkflowExportOptions = {},
): WorkflowExportResult {
  const plan = BrowserPlanSchema.parse(input);
  const testName = options.testName ?? 'Ratatoskr regression';
  if (!testName.length || testName.length > 200)
    throw new Error('Test name must contain 1–200 characters');
  const fallback = options.baseURL
    ? HttpUrlSchema.parse(options.baseURL)
    : new URL(plan.startUrl).origin;
  if (new URL(fallback).search || new URL(fallback).hash)
    throw new Error('baseURL must not contain a query or fragment');
  const steps = flattenSteps(plan.steps);
  const result: WorkflowExportResult = {
    ready: false,
    warnings: [],
    unsupported: [],
    unsupportedCount: 0,
    assertionCount: steps.filter((step) => step.action.startsWith('assert_'))
      .length,
    requiredEnvironment: [],
  };
  const unsupported = (stepIndex: number, action: string, reason: string) => {
    result.unsupportedCount++;
    if (result.unsupported.length < 25)
      result.unsupported.push({ stepIndex, action, reason });
  };
  if (!result.assertionCount)
    result.warnings.push(
      'No explicit assertions; limited regression coverage.',
    );
  const environment = new Set<string>();
  const parameters = new Set(Object.keys(plan.parameters ?? {}));
  const expression = (value: string): string => {
    const parts: string[] = [];
    let cursor = 0;
    for (const match of value.matchAll(
      /\$\{([A-Za-z_][A-Za-z0-9_]{0,63})\}/g,
    )) {
      parts.push(quote(value.slice(cursor, match.index)));
      const name = match[1]!;
      // Extraction-based values are rejected before source is returned.
      const env = `RATATOSKR_PARAM_${name}`;
      if (parameters.has(name)) environment.add(env);
      parts.push(`parameter(${quote(env)})`);
      cursor = match.index + match[0].length;
    }
    if (!parts.length) return quote(value);
    parts.push(quote(value.slice(cursor)));
    return `data(${parts.join(' + ')})`;
  };
  const locator = (target: BrowserTarget): string => {
    switch (target.kind) {
      case 'role':
        return `page.getByRole(${quote(target.role)} as Parameters<typeof page.getByRole>[0]${target.name ? `, { name: ${expression(target.name)}, exact: true }` : ''})`;
      case 'label':
        return `page.getByLabel(${expression(target.label)}, { exact: true })`;
      case 'text':
        return `page.getByText(${expression(target.text)}, { exact: true })`;
      case 'testId':
        return `page.getByTestId(${expression(target.testId)})`;
      case 'css':
        return `page.locator(${quote(target.selector)})`;
    }
  };
  const navigation = (url: string, index: number): string => {
    const parsed = new URL(url);
    if (parsed.search || parsed.hash)
      unsupported(
        index,
        'navigate',
        'Navigation queries/fragments require a reviewed fixture or external URL parameter; they may contain credentials.',
      );
    return `await navigate(${expression(url)}, ${index < 0 ? 5000 : (steps[index]?.timeoutMs ?? 5000)});`;
  };
  const statements = [navigation(plan.startUrl, -1)];
  for (const [index, step] of steps.entries()) {
    if (step.continueOnFailure)
      unsupported(index, step.action, 'continueOnFailure is not exported.');
    if (step.action !== 'branch' && (step.retry !== undefined || step.recover))
      unsupported(
        index,
        step.action,
        'Explicit retry/recovery is not exported.',
      );
    const timeout = step.timeoutMs ?? 5000;
    const timed = `{ timeout: ${timeout} }`;
    switch (step.action) {
      case 'discover':
      case 'branch':
      case 'extract_text':
      case 'extract_attribute':
      case 'upload_file':
      case 'expect_download':
        unsupported(
          index,
          step.action,
          'Operation requires manual test setup.',
        );
        break;
      case 'navigate':
        statements.push(navigation(step.url, index));
        break;
      case 'click':
        if (step.dialog || step.expectPopup)
          unsupported(
            index,
            step.action,
            'Dialog/popup policy is not exported.',
          );
        statements.push(`await ${locator(step.target)}.click(${timed});`);
        break;
      case 'fill': {
        let value: string;
        if (step.valueRef) {
          environment.add(step.valueRef);
          value = `requiredEnv(${quote(step.valueRef)})`;
        } else value = expression(step.value!);
        statements.push(
          `await ${locator(step.target)}.fill(${value}, ${timed});`,
        );
        break;
      }
      case 'press':
        statements.push(
          `await ${locator(step.target)}.press(${quote(step.key)}, ${timed});`,
        );
        break;
      case 'select_option': {
        const option = step.option;
        const value =
          option.kind === 'index'
            ? String(option.index)
            : expression(option.kind === 'value' ? option.value : option.label);
        statements.push(
          `await ${locator(step.target)}.selectOption({ ${option.kind}: ${value} }, ${timed});`,
        );
        break;
      }
      case 'check':
      case 'uncheck':
      case 'hover':
        statements.push(
          `await ${locator(step.target)}.${step.action}(${timed});`,
        );
        break;
      case 'wait_for':
        statements.push(
          `await ${locator(step.target)}.waitFor({ state: 'visible', timeout: ${timeout} });`,
        );
        break;
      case 'assert_visible':
        statements.push(
          `await expect(${locator(step.target)}).toBeVisible(${timed});`,
        );
        break;
      case 'assert_text':
        // The adapter uses Playwright hasText matching, not toContainText's
        // case-sensitive matching. Keep both matching and visibility semantics.
        statements.push(
          `await expect(${locator(step.target)}.filter({ hasText: ${expression(step.contains)} })).toBeVisible(${timed});`,
        );
        break;
      case 'assert_url':
        statements.push(
          `await expect(page).toHaveURL(url => (url.origin + url.pathname).includes(${expression(step.contains)}), ${timed});`,
        );
        break;
    }
  }
  result.requiredEnvironment = [...environment].sort();
  if (result.unsupportedCount) return result;
  const source = `import { test, expect } from '@playwright/test';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error('Missing required environment variable: ' + name);
  return value;
}
function parameter(name: string): string {
  const value = requiredEnv(name);
  if (value.length > 1000 || value.includes('$' + '{')) throw new Error('Invalid workflow parameter: ' + name);
  return value;
}
function data(value: string): string {
  if (value.length > 2048) throw new Error('Workflow interpolation exceeds 2048 characters');
  return value;
}

test(${quote(testName)}, async ({ page }) => {
  test.setTimeout(${plan.timeoutMs ?? DEFAULT_WORKFLOW_TIMEOUT_MS});
  const baseURL = process.env.RATATOSKR_BASE_URL ?? test.info().project.use.baseURL ?? ${quote(fallback)};
  // These workflows expect a fresh browser context; supply authentication through a reviewed fixture.
  let httpFailureObserved = false;
  let navigationRetries = 0;
  page.on('response', response => { if (response.status() >= 400) httpFailureObserved = true; });
  page.on('dialog', dialog => { void dialog.dismiss(); throw new Error('Unexpected browser dialog'); });
  page.on('popup', () => { throw new Error('Unexpected browser popup'); });
  const navigate = async (value: string, timeout: number) => {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('Invalid navigation URL');
    const destination = url.origin === ${quote(new URL(plan.startUrl).origin)} ? new URL(url.pathname + url.search + url.hash, baseURL).href : url.href;
    for (let attempt = 0; ; attempt++) {
      try { await page.goto(destination, { timeout }); return; }
      catch (error) {
        const transient = error instanceof Error && (/net::ERR_(CONNECTION_RESET|CONNECTION_CLOSED|TIMED_OUT|NETWORK_CHANGED|ABORTED)/.test(error.message) || /Navigation to .+ is interrupted by another navigation to /.test(error.message));
        if (attempt || !transient || httpFailureObserved || navigationRetries >= 60) throw error;
        navigationRetries++;
        await page.waitForTimeout(250); // Bounded transient-navigation backoff, never a readiness wait.
      }
    }
  };
${statements.map((line) => `  ${line}`).join('\n')}
});
`;
  if (Buffer.byteLength(source) > MAX_EXPORTED_SOURCE_BYTES) {
    unsupported(-1, 'workflow', 'Generated source exceeds 64000 bytes.');
    return result;
  }
  result.ready = true;
  result.source = source;
  return result;
}
