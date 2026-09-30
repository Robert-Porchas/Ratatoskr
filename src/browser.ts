import type { BrowserTarget } from './protocol.js';
import type { EvidenceInput } from './evidence.js';

export interface BrowserAdapter {
  start(emit: (event: EvidenceInput) => void, trace: boolean): Promise<void>;
  stop(tracePath?: string): Promise<void>;
  navigate(url: string, timeoutMs: number): Promise<void>;
  click(target: BrowserTarget, timeoutMs: number): Promise<void>;
  fill(target: BrowserTarget, value: string, timeoutMs: number): Promise<void>;
  press(target: BrowserTarget, key: string, timeoutMs: number): Promise<void>;
  waitFor(target: BrowserTarget, timeoutMs: number): Promise<void>;
  text(target: BrowserTarget, timeoutMs: number): Promise<string>;
  isVisible(target: BrowserTarget, timeoutMs: number): Promise<boolean>;
  currentUrl(): Promise<string>;
  screenshot(): Promise<Buffer>;
}
