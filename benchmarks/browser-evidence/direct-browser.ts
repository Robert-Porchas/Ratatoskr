import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Locator, type Page } from 'playwright';
import { z } from 'zod';
import { BrowserTargetSchema, type BrowserTarget } from '../../src/protocol.js';
import { bytes, type BrowserSession, type ToolDefinition } from './tools.js';

const empty = z.strictObject({});
const schemas = {
  browser_navigate: z.strictObject({ url: z.url() }),
  browser_inspect_page: empty,
  browser_fill: z.strictObject({
    target: BrowserTargetSchema,
    value: z.string(),
  }),
  browser_click: z.strictObject({ target: BrowserTargetSchema }),
  browser_network: empty,
  browser_console: empty,
};
const descriptions = {
  browser_navigate:
    'Navigate to the local fixture. Returns a page accessibility snapshot and form values.',
  browser_inspect_page:
    'Read the current page accessibility snapshot and form values.',
  browser_fill:
    'Fill one control. Returns the updated page snapshot and form values.',
  browser_click:
    'Click one control. Returns the updated page snapshot and form values.',
  browser_network:
    'Read observed requests and responses, including status, headers, and response bodies.',
  browser_console: 'Read browser console messages and page errors.',
};

function locator(page: Page, target: BrowserTarget): Locator {
  switch (target.kind) {
    case 'role':
      return page.getByRole(
        target.role as Parameters<Page['getByRole']>[0],
        target.name ? { name: target.name, exact: true } : undefined,
      );
    case 'label':
      return page.getByLabel(target.label, { exact: true });
    case 'text':
      return page.getByText(target.text, { exact: true });
    case 'testId':
      return page.getByTestId(target.testId);
    case 'css':
      return page.locator(target.selector);
  }
}

/** Benchmark-only direct browser adapter. No reducer, batching, synthetic padding, or snapshots of hidden source. */
export async function startDirectBrowser(
  url: string,
  directory: string,
  signal: AbortSignal,
): Promise<BrowserSession> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const network: unknown[] = [],
    consoleEvents: unknown[] = [],
    snapshots: unknown[] = [];
  const pending = new Set<Promise<void>>();
  let browserInteractions = 0;
  let closed = false;
  const abort = () => {
    void browser.close().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  page.on('request', (request) =>
    network.push({
      type: 'request',
      at: Date.now(),
      method: request.method(),
      path: new URL(request.url()).pathname,
      headers: request.headers(),
      body: request.postData(),
    }),
  );
  page.on('response', (response) => {
    const job = (async () => {
      network.push({
        type: 'response',
        at: Date.now(),
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
        headers: response.headers(),
        body: await response.text().catch(() => '[unavailable]'),
      });
    })();
    pending.add(job);
    void job.finally(() => pending.delete(job));
  });
  page.on('console', (message) =>
    consoleEvents.push({
      type: 'console',
      at: Date.now(),
      level: message.type(),
      message: message.text(),
    }),
  );
  page.on('pageerror', (error) =>
    consoleEvents.push({
      type: 'page_error',
      at: Date.now(),
      message: error.message,
    }),
  );
  const snapshot = async () => {
    browserInteractions++;
    const observation = {
      url: page.url(),
      accessibility: await page.locator('body').ariaSnapshot(),
      controls: await Promise.all(
        (await page.locator('input').all()).map(async (input) => ({
          name: await input.getAttribute('name'),
          value: await input.inputValue(),
        })),
      ),
    };
    snapshots.push({ at: Date.now(), ...observation });
    return observation;
  };
  const tools: ToolDefinition[] = Object.entries(schemas).map(
    ([name, schema]) => ({
      name,
      description: descriptions[name as keyof typeof descriptions],
      inputSchema: z.toJSONSchema(schema),
    }),
  );
  const flush = async () => {
    await Promise.all([...pending]);
  };
  return {
    tools,
    async call(name, args) {
      signal.throwIfAborted();
      let result: unknown;
      switch (name) {
        case 'browser_navigate': {
          const parsed = schemas.browser_navigate.parse(args);
          if (parsed.url !== url)
            throw new Error('Only the exact fixture URL is permitted');
          browserInteractions++;
          await page.goto(parsed.url);
          result = await snapshot();
          break;
        }
        case 'browser_inspect_page':
          empty.parse(args);
          result = await snapshot();
          break;
        case 'browser_fill': {
          const parsed = schemas.browser_fill.parse(args);
          browserInteractions++;
          await locator(page, parsed.target).fill(parsed.value);
          result = await snapshot();
          break;
        }
        case 'browser_click': {
          const parsed = schemas.browser_click.parse(args);
          browserInteractions++;
          // Condition-based synchronization with this fixture's submit response, not an arbitrary delay.
          await Promise.all([
            page.waitForResponse(
              (response) => new URL(response.url()).pathname === '/api/profile',
            ),
            locator(page, parsed.target).click(),
          ]);
          await page
            .getByRole('status')
            .filter({ hasText: /saved|Unable to save/ })
            .waitFor();
          result = await snapshot();
          break;
        }
        case 'browser_network':
          empty.parse(args);
          await flush();
          browserInteractions++;
          result = network;
          break;
        case 'browser_console':
          empty.parse(args);
          browserInteractions++;
          result = consoleEvents;
          break;
        default:
          throw new Error(`Unknown direct browser tool: ${name}`);
      }
      return { text: JSON.stringify(result) };
    },
    async metrics() {
      await flush();
      const evidence = { network, console: consoleEvents, snapshots };
      await writeFile(
        join(directory, 'direct-evidence.json'),
        JSON.stringify(evidence, null, 2),
      );
      return {
        rawEvidenceBytes: bytes(evidence),
        artifactBytes: 0,
        browserInteractions,
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      signal.removeEventListener('abort', abort);
      await browser.close();
    },
  };
}
