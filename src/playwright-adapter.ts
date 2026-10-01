import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Dialog,
} from 'playwright';
import type {
  BrowserOption,
  BrowserTarget,
  DialogExpectation,
} from './protocol.js';
import type { BrowserAdapter } from './browser.js';
import type { EvidenceInput } from './evidence.js';
import { basename, extname } from 'node:path';
import { BridgeError } from './errors.js';

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
  private readonly filledValues = new Set<string>();
  private readonly responseMime = new Map<string, string>();
  private emit: ((event: EvidenceInput) => void) | undefined;
  private unexpectedIssue: string | undefined;
  private stopPromise: Promise<void> | undefined;
  private activeClick:
    | {
        dialog?: DialogExpectation & { value?: string };
        expectPopup?: boolean;
        dialogSeen: boolean;
        popupSeen: boolean;
        issue?: string;
      }
    | undefined;

  async start(
    emit: (event: EvidenceInput) => void,
    trace: boolean,
  ): Promise<void> {
    this.stopPromise = undefined;
    this.emit = emit;
    try {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext();
      if (trace) {
        await this.context.tracing.start({
          screenshots: true,
          snapshots: true,
        });
        this.tracing = true;
      }
      this.attachPage(await this.context.newPage(), emit);
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  private attachPage(page: Page, emit: (event: EvidenceInput) => void): void {
    this.page = page;
    page.on('request', (request) =>
      emit({
        type: 'request',
        method: request.method(),
        path: safePath(request.url()),
      }),
    );
    page.on('response', (response) => {
      const mime = response.headers()['content-type'];
      if (mime)
        this.responseMime.set(response.url(), mime.split(';', 1)[0] ?? mime);
      if (response.status() >= 400)
        emit({
          type: 'http',
          method: response.request().method(),
          path: safePath(response.url()),
          status: response.status(),
        });
    });
    page.on('requestfailed', (request) =>
      emit({
        type: 'request_failed',
        method: request.method(),
        path: safePath(request.url()),
        error: request.failure()?.errorText ?? 'request failed',
      }),
    );
    page.on('console', (message) =>
      emit({ type: 'console', level: message.type(), message: message.text() }),
    );
    page.on('pageerror', (error) =>
      emit({ type: 'page_error', message: error.message }),
    );
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame())
        emit({ type: 'navigation', url: safeUrl(frame.url()) });
    });
    page.on('dialog', (dialog) => {
      const expected = this.activeClick?.dialog?.type === dialog.type();
      emit({ type: 'dialog', dialogType: dialog.type(), expected });
      if (expected && this.activeClick) this.activeClick.dialogSeen = true;
      else {
        this.unexpectedIssue = `Unexpected ${dialog.type()} dialog`;
        if (this.activeClick) this.activeClick.issue = this.unexpectedIssue;
      }
      void this.settleDialog(
        dialog,
        expected ? this.activeClick?.dialog : undefined,
      );
    });
    page.on('popup', (popup) => {
      const expected = this.activeClick?.expectPopup === true;
      emit({ type: 'popup', url: safeUrl(popup.url()), expected });
      if (expected && this.activeClick) this.activeClick.popupSeen = true;
      else {
        this.unexpectedIssue = 'Unexpected popup opened';
        if (this.activeClick) this.activeClick.issue = this.unexpectedIssue;
        void popup.close().catch(() => undefined);
      }
    });
  }

  private async settleDialog(
    dialog: Dialog,
    policy?: DialogExpectation & { value?: string },
  ): Promise<void> {
    try {
      if (policy?.action === 'accept') await dialog.accept(policy.value);
      else await dialog.dismiss();
    } catch {
      if (this.activeClick)
        this.activeClick.issue = 'Could not handle JavaScript dialog';
    }
  }

  async stop(tracePath?: string): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopInternal(tracePath);
    return this.stopPromise;
  }

  private async stopInternal(tracePath?: string): Promise<void> {
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
      this.filledValues.clear();
      this.responseMime.clear();
      this.activeClick = undefined;
      this.unexpectedIssue = undefined;
      this.emit = undefined;
    }
  }

  private getPage(): Page {
    if (this.unexpectedIssue)
      throw new BridgeError('browser_execution', this.unexpectedIssue);
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
  async click(
    target: BrowserTarget,
    timeoutMs: number,
    options?: {
      expectPopup?: boolean;
      dialog?: DialogExpectation & { value?: string };
    },
  ): Promise<void> {
    const page = this.getPage();
    this.activeClick = { ...options, dialogSeen: false, popupSeen: false };
    try {
      if (options?.expectPopup) {
        const [opened] = await Promise.all([
          page.waitForEvent('popup', { timeout: timeoutMs }),
          this.locator(target).click({ timeout: timeoutMs }),
        ]);
        await opened.waitForLoadState('domcontentloaded', {
          timeout: timeoutMs,
        });
        if (this.emit) this.attachPage(opened, this.emit);
      } else await this.locator(target).click({ timeout: timeoutMs });
      if (this.activeClick.issue)
        throw new BridgeError('browser_execution', this.activeClick.issue);
      if (options?.dialog && !this.activeClick.dialogSeen)
        throw new BridgeError(
          'browser_execution',
          `Expected ${options.dialog.type} dialog did not open`,
        );
    } finally {
      this.activeClick = undefined;
    }
  }
  async fill(
    target: BrowserTarget,
    value: string,
    timeoutMs: number,
  ): Promise<void> {
    if (value) this.filledValues.add(value);
    await this.locator(target).fill(value, { timeout: timeoutMs });
  }
  async press(
    target: BrowserTarget,
    key: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.locator(target).press(key, { timeout: timeoutMs });
  }
  async selectOption(
    target: BrowserTarget,
    option: BrowserOption,
    timeoutMs: number,
  ): Promise<void> {
    const selection =
      option.kind === 'value'
        ? { value: option.value }
        : option.kind === 'label'
          ? { label: option.label }
          : { index: option.index };
    await this.locator(target).selectOption(selection, { timeout: timeoutMs });
  }
  async setChecked(
    target: BrowserTarget,
    checked: boolean,
    timeoutMs: number,
  ): Promise<void> {
    if (checked) await this.locator(target).check({ timeout: timeoutMs });
    else await this.locator(target).uncheck({ timeout: timeoutMs });
  }
  async hover(target: BrowserTarget, timeoutMs: number): Promise<void> {
    await this.locator(target).hover({ timeout: timeoutMs });
  }
  async upload(
    target: BrowserTarget,
    filePath: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.locator(target).setInputFiles(filePath, { timeout: timeoutMs });
  }
  async download(
    target: BrowserTarget,
    destination: string,
    timeoutMs: number,
  ): Promise<{ fileName: string; mimeType: string }> {
    const page = this.getPage();
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: timeoutMs }),
      this.locator(target).click({ timeout: timeoutMs }),
    ]);
    await download.saveAs(destination);
    const fileName = basename(download.suggestedFilename());
    const extension = extname(fileName).toLowerCase();
    const fallback =
      extension === '.txt'
        ? 'text/plain'
        : extension === '.csv'
          ? 'text/csv'
          : extension === '.pdf'
            ? 'application/pdf'
            : 'application/octet-stream';
    return {
      fileName,
      mimeType: this.responseMime.get(download.url()) ?? fallback,
    };
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
  async attribute(
    target: BrowserTarget,
    name: string,
    timeoutMs: number,
  ): Promise<string | null> {
    return this.locator(target).getAttribute(name, { timeout: timeoutMs });
  }
  async waitForUrlContains(contains: string, timeoutMs: number): Promise<void> {
    await this.getPage().waitForURL(
      (url) => safeUrl(url.href).includes(contains),
      { timeout: timeoutMs },
    );
  }
  async waitForTextContains(
    target: BrowserTarget,
    contains: string,
    timeoutMs: number,
  ): Promise<void> {
    await this.locator(target)
      .filter({ hasText: contains })
      .waitFor({ state: 'visible', timeout: timeoutMs });
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
      mask: [
        page.locator('input, textarea, [contenteditable="true"]'),
        ...[...this.filledValues].map((value) => page.getByText(value)),
      ],
      maskColor: '#000000',
    });
  }
}
