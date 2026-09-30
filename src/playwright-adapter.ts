import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import type { BrowserTarget } from './protocol.js';
import type { BrowserAdapter } from './browser.js';
import type { EvidenceInput } from './evidence.js';

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid URL]';
  }
}

function safePath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return '[invalid URL]';
  }
}

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private tracing = false;

  async start(
    emit: (event: EvidenceInput) => void,
    trace: boolean,
  ): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext();
    if (trace) {
      await this.context.tracing.start({ screenshots: true, snapshots: true });
      this.tracing = true;
    }
    this.page = await this.context.newPage();
    this.page.on('request', (request) =>
      emit({
        type: 'request',
        method: request.method(),
        path: safePath(request.url()),
      }),
    );
    this.page.on('response', (response) => {
      if (response.status() >= 400)
        emit({
          type: 'http',
          method: response.request().method(),
          path: safePath(response.url()),
          status: response.status(),
        });
    });
    this.page.on('requestfailed', (request) =>
      emit({
        type: 'request_failed',
        method: request.method(),
        path: safePath(request.url()),
        error: request.failure()?.errorText ?? 'request failed',
      }),
    );
    this.page.on('console', (message) =>
      emit({ type: 'console', level: message.type(), message: message.text() }),
    );
    this.page.on('pageerror', (error) =>
      emit({ type: 'page_error', message: error.message }),
    );
    this.page.on('framenavigated', (frame) => {
      if (frame === this.page?.mainFrame())
        emit({ type: 'navigation', url: safeUrl(frame.url()) });
    });
  }

  async stop(tracePath?: string): Promise<void> {
    try {
      if (this.tracing && this.context) {
        if (tracePath) await this.context.tracing.stop({ path: tracePath });
        else await this.context.tracing.stop();
      }
    } finally {
      await this.browser?.close();
      this.page = undefined;
      this.context = undefined;
      this.browser = undefined;
      this.tracing = false;
    }
  }

  private getPage(): Page {
    if (!this.page) throw new Error('Browser has not started');
    return this.page;
  }

  private locator(target: BrowserTarget): Locator {
    const page = this.getPage();
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

  async navigate(url: string, timeoutMs: number): Promise<void> {
    await this.getPage().goto(url, { timeout: timeoutMs });
  }
  async click(target: BrowserTarget, timeoutMs: number): Promise<void> {
    await this.locator(target).click({ timeout: timeoutMs });
  }
  async fill(
    target: BrowserTarget,
    value: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.locator(target).fill(value, { timeout: timeoutMs });
  }
  async press(
    target: BrowserTarget,
    key: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.locator(target).press(key, { timeout: timeoutMs });
  }
  async waitFor(target: BrowserTarget, timeoutMs: number): Promise<void> {
    await this.locator(target).waitFor({
      state: 'visible',
      timeout: timeoutMs,
    });
  }
  async text(target: BrowserTarget, timeoutMs: number): Promise<string> {
    return this.locator(target).innerText({ timeout: timeoutMs });
  }
  async isVisible(target: BrowserTarget, timeoutMs: number): Promise<boolean> {
    try {
      await this.locator(target).waitFor({
        state: 'visible',
        timeout: timeoutMs,
      });
      return true;
    } catch {
      return false;
    }
  }
  async currentUrl(): Promise<string> {
    return safeUrl(this.getPage().url());
  }
  async screenshot(): Promise<Buffer> {
    const page = this.getPage();
    return page.screenshot({
      fullPage: true,
      mask: [page.locator('input, textarea, [contenteditable="true"]')],
      maskColor: '#000000',
    });
  }
}
