import type {
  BrowserOption,
  BrowserTarget,
  DialogExpectation,
} from './protocol.js';
import type { EvidenceInput } from './evidence.js';
import type {
  SessionSnapshot,
  SessionResponse,
  SessionStamp,
} from './session.js';

export interface SessionObservation {
  protect(value: string): void;
  fingerprint(value: string): string;
  response(response: SessionResponse): void;
}

export interface BrowserAdapter {
  start(
    emit: (event: EvidenceInput) => void,
    trace: boolean,
    session?: SessionObservation,
  ): Promise<void>;
  stop(tracePath?: string): Promise<void>;
  navigate(url: string, timeoutMs: number): Promise<void>;
  click(
    target: BrowserTarget,
    timeoutMs: number,
    options?: {
      expectPopup?: boolean;
      dialog?: DialogExpectation & { value?: string };
    },
  ): Promise<void>;
  fill(target: BrowserTarget, value: string, timeoutMs: number): Promise<void>;
  press(target: BrowserTarget, key: string, timeoutMs: number): Promise<void>;
  selectOption(
    target: BrowserTarget,
    option: BrowserOption,
    timeoutMs: number,
  ): Promise<void>;
  setChecked(
    target: BrowserTarget,
    checked: boolean,
    timeoutMs: number,
  ): Promise<void>;
  hover(target: BrowserTarget, timeoutMs: number): Promise<void>;
  upload(
    target: BrowserTarget,
    filePath: string,
    timeoutMs: number,
  ): Promise<void>;
  download(
    target: BrowserTarget,
    destination: string,
    timeoutMs: number,
  ): Promise<{ fileName: string; mimeType: string }>;
  waitFor(target: BrowserTarget, timeoutMs: number): Promise<void>;
  text(target: BrowserTarget, timeoutMs: number): Promise<string>;
  attribute(
    target: BrowserTarget,
    name: string,
    timeoutMs: number,
  ): Promise<string | null>;
  waitForUrlContains(contains: string, timeoutMs: number): Promise<void>;
  waitForTextContains(
    target: BrowserTarget,
    contains: string,
    timeoutMs: number,
  ): Promise<void>;
  isVisible(target: BrowserTarget, timeoutMs: number): Promise<boolean>;
  currentUrl(): Promise<string>;
  /** Optional diagnostic probe; never returns page content or chooses another target. */
  targetExists?(target: BrowserTarget): Promise<boolean>;
  screenshot(): Promise<Buffer>;
  /** Internal observation only; unavailable in BrowserPlan. */
  setSessionStep?(stepIndex: number | null): void;
  sessionSnapshot?(
    full: boolean,
    stamp: SessionStamp,
  ): Promise<SessionSnapshot>;
  hasSensitiveSession?(): boolean;
  authenticationState?(): Promise<Buffer>;
}
