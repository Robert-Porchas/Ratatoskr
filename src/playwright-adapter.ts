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
import type { BrowserAdapter, SessionObservation } from './browser.js';
import {
  observeSetCookie,
  type SessionSnapshot,
  type SessionStamp,
} from './session.js';
import type { EvidenceInput } from './evidence.js';
import { basename, extname } from 'node:path';
import { RatatoskrError } from './errors.js';
import { transientNavigationError } from './workflow-retry.js';
import {
  DiscoveryOptionsSchema,
  rankDiscoveryCandidates,
  type DiscoveryOptions,
  type DiscoveryResult,
} from './discovery.js';

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return '[non-HTTP URL]';
    return `${url.origin}${url.pathname}`;
  } catch {
    return '[invalid URL]';
  }
}

function safePath(value: string): string {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.pathname : '[non-HTTP URL]';
  } catch {
    return '[invalid URL]';
  }
}

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  private readonly correlationHeaders: readonly string[];

  constructor(options: { correlationHeaders?: readonly string[] } = {}) {
    const allowed = new Set([
      'x-request-id',
      'x-correlation-id',
      'traceparent',
    ]);
    this.correlationHeaders = [...new Set(options.correlationHeaders ?? [])]
      .filter((name) => allowed.has(name))
      .slice(0, 3);
  }

  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private tracing = false;
  private readonly filledValues = new Set<string>();
  private readonly responseMime = new Map<string, string>();
  private emit: ((event: EvidenceInput) => void) | undefined;
  private unexpectedIssue: string | undefined;
  private stopPromise: Promise<void> | undefined;
  private session: SessionObservation | undefined;
  private sessionStep: number | null = null;
  private sensitiveSession = false;
  private tabId = 0;
  private readonly pendingResponses = new Set<Promise<void>>();
  private readonly documentMethods = new WeakMap<Page, string>();
  private activeClick:
    | {
        dialog?: DialogExpectation & { value?: string };
        safeRetry?: boolean;
        expectPopup?: boolean;
        dialogSeen: boolean;
        popupSeen: boolean;
        issue?: string;
      }
    | undefined;

  async start(
    emit: (event: EvidenceInput) => void,
    trace: boolean,
    session?: SessionObservation,
  ): Promise<void> {
    this.stopPromise = undefined;
    this.emit = emit;
    this.session = session;
    this.sensitiveSession = false;
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
    this.tabId++;
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        this.documentMethods.set(page, request.method());
      for (const name of ['authorization', 'proxy-authorization']) {
        const authorization = request.headers()[name];
        if (authorization) {
          this.protectSessionValue(authorization);
          this.protectSessionValue(authorization.replace(/^\S+\s+/, ''));
        }
      }
      if (this.session) {
        // headers() omits security headers. Never persist the complete headers;
        // use them only to protect values, including credentials on failed requests.
        const protection = request
          .allHeaders()
          .then((headers) => {
            for (const name of ['authorization', 'proxy-authorization']) {
              const value = headers[name];
              if (value) {
                this.protectSessionValue(value);
                this.protectSessionValue(value.replace(/^\S+\s+/, ''));
              }
            }
            for (const pair of (headers.cookie ?? '').split(';')) {
              const separator = pair.indexOf('=');
              if (separator >= 0)
                this.protectSessionValue(pair.slice(separator + 1).trim());
            }
          })
          .catch(() => undefined);
        this.pendingResponses.add(protection);
        void protection.finally(() => this.pendingResponses.delete(protection));
      }
      emit({
        type: 'request',
        method: request.method(),
        path: safePath(request.url()),
        url: safeUrl(request.url()),
        ...(new URL(request.url()).search ? { urlQueryOmitted: true } : {}),
      });
    });
    page.on('response', (response) => {
      const at = Date.now();
      const stepIndex = this.sessionStep;
      const mime = response.headers()['content-type'];
      if (mime)
        this.responseMime.set(response.url(), mime.split(';', 1)[0] ?? mime);
      const correlationIds: Record<string, string> = {};
      const responseHeaders = response.headers();
      for (const name of this.correlationHeaders) {
        const value = responseHeaders[name];
        if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value))
          continue;
        if (name === 'traceparent') {
          const parsed =
            /^([a-f0-9]{2})-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(
              value,
            );
          if (
            !parsed ||
            parsed[1] === 'ff' ||
            /^0+$/.test(parsed[2]!) ||
            /^0+$/.test(parsed[3]!)
          )
            continue;
        }
        correlationIds[name] = value;
      }
      emit({
        type: 'http',
        observedStepIndex: stepIndex,
        method: response.request().method(),
        path: safePath(response.url()),
        url: safeUrl(response.url()),
        ...(new URL(response.url()).search ? { urlQueryOmitted: true } : {}),
        status: response.status(),
        ...(Object.keys(correlationIds).length ? { correlationIds } : {}),
      });
      const observation = (async () => {
        const headers = await response.headerValues('set-cookie');
        const cookies = headers.flatMap((header) => {
          this.sensitiveSession = true;
          const observed = observeSetCookie(header, (value) =>
            this.protectSessionValue(value),
          );
          return observed ? [observed] : [];
        });
        if (
          cookies.length ||
          response.status() === 401 ||
          response.status() === 403 ||
          response.request().method() === 'POST' ||
          (response.status() >= 300 && response.status() < 400)
        )
          this.session?.response({
            at,
            stepIndex,
            method: response.request().method(),
            path: safePath(response.url()),
            origin: new URL(response.url()).origin,
            status: response.status(),
            cookies: cookies.slice(0, 20),
          });
      })().catch(() => {
        /* Closed/crashed responses supply no invented header evidence. */
      });
      this.pendingResponses.add(observation);
      void observation.finally(() => this.pendingResponses.delete(observation));
    });
    page.on('requestfailed', (request) =>
      emit({
        type: 'request_failed',
        method: request.method(),
        path: safePath(request.url()),
        url: safeUrl(request.url()),
        ...(new URL(request.url()).search ? { urlQueryOmitted: true } : {}),
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
        emit({
          type: 'navigation',
          url: safeUrl(frame.url()),
          ...(frame.url().includes('?') ? { urlQueryOmitted: true } : {}),
        });
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
        if (tracePath && !this.sensitiveSession)
          await this.context.tracing.stop({ path: tracePath });
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
      this.session = undefined;
      this.pendingResponses.clear();
    }
  }

  private protectSessionValue(value: string): void {
    if (!value) return;
    this.sensitiveSession = true;
    this.session?.protect(value);
    this.filledValues.add(value);
  }

  setSessionStep(stepIndex: number | null): void {
    this.sessionStep = stepIndex;
  }
  hasSensitiveSession(): boolean {
    return this.sensitiveSession;
  }

  async sessionSnapshot(
    full: boolean,
    stamp: SessionStamp,
  ): Promise<SessionSnapshot> {
    const context = this.context;
    const page = this.page;
    if (!context || !page || !this.session)
      throw new Error('Session observation unavailable');
    // Flush response-header observations before comparing browser-retained cookies.
    await Promise.all([...this.pendingResponses]);
    const state = full
      ? await context.storageState({
          indexedDB: false,
          credentials: false,
          opfs: false,
        })
      : undefined;
    const cookies = await context.cookies();
    const storage: SessionSnapshot['storage'] = [];
    const storageOrigins: string[] = [];
    for (const cookie of cookies) this.protectSessionValue(cookie.value);
    let storageComplete = full;
    if (state) {
      for (const origin of state.origins) {
        storageOrigins.push(origin.origin);
        for (const entry of origin.localStorage) {
          this.protectSessionValue(entry.value);
          storage.push({
            origin: origin.origin,
            area: 'local',
            key: entry.name,
            fingerprint: this.session.fingerprint(entry.value),
          });
        }
      }
      // Fixed, read-only code. No workflow can supply or alter this expression.
      const tab = await page.evaluate(() => {
        const origin = location.origin;
        const entries: Array<{ key: string; value: string }> = [];
        let complete = true;
        try {
          const count = Math.min(sessionStorage.length, 100);
          complete = sessionStorage.length <= 100;
          for (let index = 0; index < count; index++) {
            const key = sessionStorage.key(index);
            if (key === null) continue;
            entries.push({ key, value: sessionStorage.getItem(key) ?? '' });
          }
        } catch {
          complete = false;
        }
        return { origin, entries, complete };
      });
      if (/^https?:/.test(tab.origin)) {
        if (!storageOrigins.includes(tab.origin))
          storageOrigins.push(tab.origin);
        for (const entry of tab.entries) {
          this.protectSessionValue(entry.value);
          storage.push({
            origin: tab.origin,
            area: 'session',
            key: entry.key,
            fingerprint: this.session.fingerprint(entry.value),
          });
        }
      }
      storageComplete = tab.complete && storage.length <= 200;
    }
    return {
      ...stamp,
      tabId: this.tabId,
      at: Date.now(),
      cookies: cookies.slice(0, 200).map((cookie) => ({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
        ...(cookie.partitionKey ? { partitionKey: cookie.partitionKey } : {}),
        fingerprint: this.session!.fingerprint(cookie.value),
      })),
      storage: storage.slice(0, 200),
      storageOrigins,
      storageComplete,
      cookiesComplete: cookies.length <= 200,
    };
  }

  async authenticationState(): Promise<Buffer> {
    if (!this.context) throw new Error('Browser has not started');
    return Buffer.from(
      JSON.stringify(
        await this.context.storageState({
          indexedDB: false,
          credentials: false,
          opfs: false,
        }),
      ),
    );
  }

  private getPage(): Page {
    if (this.unexpectedIssue)
      throw new RatatoskrError('browser_execution', this.unexpectedIssue);
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
    try {
      await this.getPage().goto(url, { timeout: timeoutMs });
    } catch (error) {
      if (transientNavigationError(error))
        throw new RatatoskrError(
          'navigation_transient',
          'Transient navigation transport failure',
        );
      throw error;
    }
  }
  async reload(timeoutMs: number): Promise<void> {
    const page = this.getPage();
    if (this.documentMethods.get(page) !== 'GET')
      throw new RatatoskrError(
        'side_effect_state_unknown',
        'SIDE_EFFECT_STATE_UNKNOWN: refusing to reload a non-GET document',
      );
    await page.reload({ timeout: timeoutMs });
  }
  async click(
    target: BrowserTarget,
    timeoutMs: number,
    options?: {
      safeRetry?: boolean;
      expectPopup?: boolean;
      dialog?: DialogExpectation & { value?: string };
    },
  ): Promise<void> {
    const page = this.getPage();
    if (options?.safeRetry) {
      try {
        await this.locator(target).click({ trial: true, timeout: timeoutMs });
      } catch (error) {
        if (error instanceof Error && error.name === 'TimeoutError')
          throw new RatatoskrError(
            'target_not_ready',
            'Click target was not ready before dispatch',
          );
        throw error;
      }
    }
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
        throw new RatatoskrError('browser_execution', this.activeClick.issue);
      if (options?.dialog && !this.activeClick.dialogSeen)
        throw new RatatoskrError(
          'browser_execution',
          `Expected ${options.dialog.type} dialog did not open`,
        );
    } catch (error) {
      if (options?.safeRetry)
        throw new RatatoskrError(
          'side_effect_state_unknown',
          'SIDE_EFFECT_STATE_UNKNOWN: click may have been dispatched',
        );
      throw error;
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
  async targetExists(target: BrowserTarget): Promise<boolean> {
    return (await this.locator(target).count()) > 0;
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
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') return false;
      throw error;
    }
  }
  async currentUrl(): Promise<string> {
    return safeUrl(this.getPage().url());
  }
  async discover(options: DiscoveryOptions): Promise<DiscoveryResult> {
    const parsed = DiscoveryOptionsSchema.parse(options);
    const page = this.getPage();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async (): Promise<DiscoveryResult> => {
      // Fixed read-only code: no user supplied expression, values or frame traversal.
      const scan = await page.evaluate(() => {
        const startedAt = Date.now();
        const candidates: Array<{
          role: string;
          name: string;
          visible: boolean;
          enabled: boolean;
          nameIncomplete: boolean;
        }> = [];
        let nameIncomplete = false;
        const helpers = {
          text(element: Element): string {
            const walker = document.createTreeWalker(
              element,
              NodeFilter.SHOW_TEXT,
            );
            let result = '';
            let node: Node | null;
            let visited = 0;
            while (
              (node = walker.nextNode()) &&
              visited++ < 100 &&
              result.length < 180
            ) {
              if (
                node.parentElement?.closest(
                  'input,textarea,select,[contenteditable],script,style,[hidden],[aria-hidden="true"]',
                )
              )
                continue;
              result += ` ${node.textContent?.slice(0, 180) ?? ''}`;
            }
            const normalized = result.replace(/\s+/g, ' ').trim();
            nameIncomplete ||=
              visited >= 100 || result.length >= 180 || normalized.length > 160;
            return normalized.slice(0, 160);
          },
          nameOf(element: Element, role: string): string {
            const labelIds = element.getAttribute('aria-labelledby');
            nameIncomplete ||= (labelIds?.length ?? 0) > 1024;
            const labelledBy = labelIds?.slice(0, 1024);
            if (labelledBy) {
              const label = labelledBy
                .split(/\s+/)
                .slice(0, 5)
                .map((id) => document.getElementById(id))
                .filter((item): item is HTMLElement => item !== null)
                .map(helpers.text)
                .join(' ')
                .trim();
              nameIncomplete ||= label.length > 160;
              if (label) return label.slice(0, 160);
            }
            const aria = element.getAttribute('aria-label');
            if (aria) {
              nameIncomplete ||= aria.length > 160;
              return aria.slice(0, 160);
            }
            if (
              element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement ||
              element instanceof HTMLSelectElement
            ) {
              const labels = [...[0, 1, 2]]
                .map((index) => element.labels?.[index])
                .filter(
                  (label): label is HTMLLabelElement => label !== undefined,
                )
                .map(helpers.text)
                .join(' ');
              nameIncomplete ||= labels.length > 160;
              return labels.slice(0, 160);
            }
            if (element instanceof HTMLImageElement) {
              nameIncomplete ||= element.alt.length > 160;
              return element.alt.slice(0, 160);
            }
            if (
              [
                'button',
                'link',
                'heading',
                'option',
                'tab',
                'menuitem',
                'checkbox',
                'radio',
                'switch',
              ].includes(role)
            )
              return helpers.text(element);
            return '';
          },
          roleOf(element: Element): string {
            const roleAttribute = element.getAttribute('role');
            if (roleAttribute && roleAttribute.length > 32) return '';
            const explicit = roleAttribute?.split(/\s+/, 1)[0];
            if (explicit)
              return [
                'button',
                'link',
                'textbox',
                'searchbox',
                'checkbox',
                'radio',
                'combobox',
                'listbox',
                'option',
                'heading',
                'tab',
                'menuitem',
                'switch',
                'slider',
                'spinbutton',
                'img',
                'region',
                'dialog',
                'alert',
                'status',
                'navigation',
                'main',
                'form',
              ].includes(explicit)
                ? explicit
                : '';
            if (
              element instanceof HTMLButtonElement ||
              element.tagName === 'SUMMARY'
            )
              return 'button';
            if (
              element instanceof HTMLAnchorElement &&
              element.hasAttribute('href')
            )
              return 'link';
            if (/^H[1-6]$/.test(element.tagName)) return 'heading';
            if (element instanceof HTMLInputElement) {
              if (element.type === 'checkbox' || element.type === 'radio')
                return element.type;
              if (['button', 'submit', 'reset', 'image'].includes(element.type))
                return 'button';
              if (element.type === 'number') return 'spinbutton';
              if (element.type === 'range') return 'slider';
              if (element.type === 'search') return 'searchbox';
              if (['text', 'email', 'tel', 'url'].includes(element.type))
                return 'textbox';
            }
            if (element instanceof HTMLTextAreaElement) return 'textbox';
            if (element instanceof HTMLSelectElement)
              return element.multiple || element.size > 1
                ? 'listbox'
                : 'combobox';
            if (element instanceof HTMLOptionElement) return 'option';
            if (element instanceof HTMLImageElement && element.alt)
              return 'img';
            if (element.tagName === 'NAV') return 'navigation';
            if (element.tagName === 'MAIN') return 'main';
            if (element.tagName === 'DIALOG') return 'dialog';
            return '';
          },
        };
        const walker = document.createTreeWalker(
          document.documentElement,
          NodeFilter.SHOW_ELEMENT,
        );
        let scanned = 0;
        let element: Element | null = document.documentElement;
        while (element && scanned < 1000 && Date.now() - startedAt < 100) {
          scanned++;
          if (!(
            element instanceof HTMLInputElement &&
            ['password', 'hidden'].includes(element.type)
          )) {
            const role = helpers.roleOf(element);
            if (role) {
              const style = getComputedStyle(element);
              const visible =
                element.getClientRects().length > 0 &&
                style.visibility !== 'hidden' &&
                style.visibility !== 'collapse' &&
                !element.closest('[aria-hidden="true"],[hidden]');
              const enabled =
                !element.matches(':disabled') &&
                !element.closest('[aria-disabled="true"]');
              nameIncomplete = false;
              const name = helpers.nameOf(element, role);
              candidates.push({ role, name, visible, enabled, nameIncomplete });
            }
          }
          element = walker.nextNode() as Element | null;
        }
        return { candidates, scanned, truncated: element !== null };
      });
      const ranked = rankDiscoveryCandidates(scan.candidates, parsed);
      const unique = ranked.filter(
        (candidate, index) =>
          ranked.findIndex(
            (other) =>
              other.role === candidate.role &&
              other.name === candidate.name &&
              other.visible === candidate.visible &&
              other.enabled === candidate.enabled,
          ) === index,
      );
      const result: DiscoveryResult = {
        matches: [],
        scanned: scan.scanned,
        truncated: scan.truncated || unique.length > parsed.maxResults,
        limitations: [
          'Main frame only; names use a bounded subset of accessible-name rules.',
        ],
      };
      for (const rawCandidate of unique.slice(0, parsed.maxResults)) {
        const { nameIncomplete, ...candidate } = rawCandidate;
        const target: BrowserTarget = {
          kind: 'role',
          role: candidate.role,
          ...(candidate.name ? { name: candidate.name } : {}),
        };
        let matchCount = 0;
        if (candidate.visible) {
          try {
            matchCount = await this.locator(target).count();
          } catch {
            // An unsupported/changed role gets no fabricated locator.
          }
        }
        let name = candidate.name;
        for (const secret of this.filledValues) {
          name = name.replaceAll(secret, '[REDACTED]');
          const normalized = secret.replace(/\s+/g, ' ').trim();
          if (normalized) name = name.replaceAll(normalized, '[REDACTED]');
        }
        // A truncated name may contain only a credential prefix; do not expose it.
        if (nameIncomplete) name = '[omitted: incomplete accessible name]';
        const safe = name === candidate.name;
        const match = {
          ...candidate,
          name,
          matchCount,
          ...(matchCount > 0 && safe ? { locator: target } : {}),
        };
        result.matches.push(match);
        if (Buffer.byteLength(JSON.stringify(result)) > 7_800) {
          result.matches.pop();
          result.truncated = true;
          break;
        }
      }
      if (result.matches.some((match) => !match.locator))
        result.limitations.push(
          'Some candidates have no verified visible semantic locator.',
        );
      return result;
    };
    try {
      return await Promise.race([
        work(),
        new Promise<DiscoveryResult>((resolve) => {
          timer = setTimeout(
            () =>
              resolve({
                matches: [],
                scanned: 0,
                truncated: true,
                limitations: [
                  'Discovery exceeded its 1500 ms observation budget.',
                ],
              }),
            1500,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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
