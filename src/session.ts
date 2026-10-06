import { createHmac, randomBytes } from 'node:crypto';
import type { Evidence, StepResult } from './protocol.js';

export interface CookieMetadata {
  name: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
  partitionKey?: string;
}
export interface StorageMetadata {
  origin: string;
  key: string;
  area: 'local' | 'session';
}
export interface SessionStamp {
  at: number;
  stepIndex: number | null;
}
/** Fingerprints are ephemeral, per-run HMACs. Never serialize this type. */
export interface SessionSnapshot extends SessionStamp {
  cookies: Array<CookieMetadata & { fingerprint: string }>;
  storage: Array<StorageMetadata & { fingerprint: string }>;
  cookiesComplete: boolean;
  storageOrigins: string[];
  storageComplete: boolean;
}
export type SessionChange = SessionStamp &
  (
    | {
        type: 'cookie';
        change: 'added' | 'removed' | 'value_changed' | 'metadata_changed';
        cookie: CookieMetadata;
      }
    | {
        type: 'storage';
        change: 'added' | 'removed' | 'value_changed';
        storage: StorageMetadata;
      }
  );
export interface SessionResponse extends SessionStamp {
  method: string;
  path: string;
  origin: string;
  status: number;
  cookies: Array<{
    name: string;
    domain?: string;
    path?: string;
    deletion: boolean;
  }>;
}
export interface SessionRecord {
  snapshots: Array<
    SessionStamp & {
      cookies: CookieMetadata[];
      storage: StorageMetadata[];
      cookiesComplete: boolean;
      storageComplete: boolean;
    }
  >;
  changes: SessionChange[];
  responses: SessionResponse[];
  truncated: boolean;
}
export interface SessionFinding {
  kind:
    | 'cookie_not_retained'
    | 'cookie_removed'
    | 'cookie_value_changed'
    | 'cookie_metadata_changed'
    | 'cookie_added'
    | 'storage_changed'
    | 'auth_http_failure';
  name?: string;
  key?: string;
  area?: 'local' | 'session';
  step?: number;
  response?: { method: string; path: string; status: number };
  cookiePresent?: boolean;
}
export interface SessionMetrics {
  sessionSnapshotsCaptured: number;
  cookieCountObserved: number;
  cookieDeltasDetected: number;
  storageKeyDeltasDetected: number;
  sessionFindingsReturned: number;
  sessionFindingBytes: number;
  rawLocalSessionEvidenceBytes: number;
  sensitiveArtifactsCreated: number;
  captureDurationMs: number;
  diffDurationMs: number;
}

/** One central allowlist boundary: no raw values or fingerprints cross it. */
export function sanitizeCookie(
  cookie: CookieMetadata,
  redact: (value: string) => string = (value) => value,
): CookieMetadata {
  return {
    name: redact(cookie.name).slice(0, 80),
    domain: redact(cookie.domain).slice(0, 128),
    path: redact(cookie.path).slice(0, 128),
    expires: Number.isFinite(cookie.expires) ? cookie.expires : -1,
    httpOnly: cookie.httpOnly === true,
    secure: cookie.secure === true,
    sameSite: cookie.sameSite,
    ...(cookie.partitionKey
      ? { partitionKey: redact(cookie.partitionKey).slice(0, 128) }
      : {}),
  };
}
export function sanitizeStorage(
  storage: StorageMetadata,
  redact: (value: string) => string = (value) => value,
): StorageMetadata {
  return {
    area: storage.area,
    origin: redact(storage.origin).slice(0, 200),
    key: redact(storage.key).slice(0, 80),
  };
}
export function cookieIdentity(cookie: CookieMetadata): string {
  return JSON.stringify([
    cookie.name,
    cookie.domain,
    cookie.path,
    cookie.partitionKey ?? null,
  ]);
}
const storageIdentity = (item: StorageMetadata): string =>
  JSON.stringify([item.area, item.origin, item.key]);

export function diffSessions(
  before: SessionSnapshot,
  after: SessionSnapshot,
): SessionChange[] {
  const stamp = { at: after.at, stepIndex: after.stepIndex };
  const changes: SessionChange[] = [];
  if (before.cookiesComplete && after.cookiesComplete) {
    const old = new Map(
      before.cookies.map((cookie) => [cookieIdentity(cookie), cookie]),
    );
    const next = new Map(
      after.cookies.map((cookie) => [cookieIdentity(cookie), cookie]),
    );
    for (const [id, cookie] of next) {
      const prior = old.get(id);
      const change = !prior
        ? 'added'
        : prior.fingerprint !== cookie.fingerprint
          ? 'value_changed'
          : JSON.stringify(sanitizeCookie(prior)) !==
              JSON.stringify(sanitizeCookie(cookie))
            ? 'metadata_changed'
            : undefined;
      if (change)
        changes.push({
          ...stamp,
          type: 'cookie',
          change,
          cookie: sanitizeCookie(cookie),
        });
    }
    for (const [id, cookie] of old)
      if (!next.has(id))
        changes.push({
          ...stamp,
          type: 'cookie',
          change: 'removed',
          cookie: sanitizeCookie(cookie),
        });
  }
  if (before.storageComplete && after.storageComplete) {
    const comparable = new Set(
      before.storageOrigins.filter((origin) =>
        after.storageOrigins.includes(origin),
      ),
    );
    const old = new Map(
      before.storage
        .filter((item) => comparable.has(item.origin))
        .map((item) => [storageIdentity(item), item]),
    );
    const next = new Map(
      after.storage
        .filter((item) => comparable.has(item.origin))
        .map((item) => [storageIdentity(item), item]),
    );
    for (const [id, item] of next) {
      const prior = old.get(id);
      const change = !prior
        ? 'added'
        : prior.fingerprint !== item.fingerprint
          ? 'value_changed'
          : undefined;
      if (change)
        changes.push({
          ...stamp,
          type: 'storage',
          change,
          storage: sanitizeStorage(item),
        });
    }
    for (const [id, item] of old)
      if (!next.has(id))
        changes.push({
          ...stamp,
          type: 'storage',
          change: 'removed',
          storage: sanitizeStorage(item),
        });
  }
  return changes;
}

/** Parses ONE header supplied by headerValues(), never a comma-joined header. */
export function observeSetCookie(
  header: string,
  protect: (value: string) => void,
): SessionResponse['cookies'][number] | undefined {
  const [pair, ...attributes] = header.split(';');
  const separator = pair?.indexOf('=') ?? -1;
  if (separator < 1 || !pair) return undefined;
  const name = pair.slice(0, separator).trim();
  protect(pair.slice(separator + 1).trim());
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) return undefined;
  const result: SessionResponse['cookies'][number] = {
    name: name.slice(0, 80),
    deletion: false,
  };
  for (const attribute of attributes) {
    const [key, ...parts] = attribute.trim().split('=');
    const value = parts.join('=');
    if (key?.toLowerCase() === 'domain') result.domain = value.slice(0, 128);
    if (key?.toLowerCase() === 'path') result.path = value.slice(0, 128);
    if (key?.toLowerCase() === 'max-age' && Number(value) <= 0)
      result.deletion = true;
    if (key?.toLowerCase() === 'expires' && Date.parse(value) <= Date.now())
      result.deletion = true;
  }
  return result;
}

export class SessionJournal {
  private readonly comparisonKey = randomBytes(32);
  private previousCookies: SessionSnapshot | undefined;
  private previousStorage: SessionSnapshot | undefined;
  readonly record: SessionRecord = {
    snapshots: [],
    changes: [],
    responses: [],
    truncated: false,
  };
  readonly metrics: SessionMetrics = {
    sessionSnapshotsCaptured: 0,
    cookieCountObserved: 0,
    cookieDeltasDetected: 0,
    storageKeyDeltasDetected: 0,
    sessionFindingsReturned: 0,
    sessionFindingBytes: 0,
    rawLocalSessionEvidenceBytes: 0,
    sensitiveArtifactsCreated: 0,
    captureDurationMs: 0,
    diffDurationMs: 0,
  };
  fingerprint(value: string): string {
    return createHmac('sha256', this.comparisonKey).update(value).digest('hex');
  }
  add(snapshot: SessionSnapshot): void {
    const started = performance.now();
    const changes = [
      ...(this.previousCookies
        ? diffSessions(this.previousCookies, {
            ...snapshot,
            storageComplete: false,
          })
        : []),
      ...(this.previousStorage && snapshot.storageComplete
        ? diffSessions(
            { ...this.previousStorage, cookiesComplete: false },
            snapshot,
          )
        : []),
    ];
    if (snapshot.cookiesComplete) this.previousCookies = snapshot;
    if (snapshot.storageComplete) this.previousStorage = snapshot;
    this.metrics.sessionSnapshotsCaptured++;
    this.metrics.cookieCountObserved = Math.max(
      this.metrics.cookieCountObserved,
      snapshot.cookies.length,
    );
    this.metrics.cookieDeltasDetected += changes.filter(
      (item) => item.type === 'cookie',
    ).length;
    this.metrics.storageKeyDeltasDetected += changes.filter(
      (item) => item.type === 'storage',
    ).length;
    this.record.changes.push(...changes);
    this.record.snapshots.push({
      at: snapshot.at,
      stepIndex: snapshot.stepIndex,
      cookies: snapshot.cookies.map((cookie) => sanitizeCookie(cookie)),
      storage: snapshot.storage.map((item) => sanitizeStorage(item)),
      cookiesComplete: snapshot.cookiesComplete,
      storageComplete: snapshot.storageComplete,
    });
    if (this.record.snapshots.length > 64) {
      this.record.snapshots.splice(1, 1);
      this.record.truncated = true;
    }
    if (this.record.changes.length > 500) {
      this.record.changes.splice(0, this.record.changes.length - 500);
      this.record.truncated = true;
    }
    this.metrics.diffDurationMs += performance.now() - started;
  }
  response(response: SessionResponse): void {
    this.record.responses.push(response);
    if (this.record.responses.length > 100) {
      this.record.responses.shift();
      this.record.truncated = true;
    }
  }
}

/** Evidence summaries, not root-cause claims. At most three findings / 750 bytes. */
export function reduceSession(
  record: SessionRecord,
  failed: StepResult,
  evidence: Evidence[],
): { findings: SessionFinding[] } | undefined {
  const near = (item: SessionStamp): boolean =>
    (item.stepIndex !== -1 || failed.index === -1) &&
    item.at >= failed.startedAt - 2000 &&
    item.at <= failed.endedAt + 2000;
  const findings: SessionFinding[] = [];
  const final = [...record.snapshots]
    .reverse()
    .find((snapshot) => snapshot.at <= failed.endedAt + 2000);
  const auth = [...evidence]
    .reverse()
    .find(
      (event) =>
        event.type === 'http' &&
        (event.status === 401 || event.status === 403) &&
        near(event),
    );
  for (const response of record.responses.filter(near)) {
    if (!final?.cookiesComplete || final.at < response.at) continue;
    for (const cookie of response.cookies) {
      const host = new URL(response.origin).hostname;
      const domain = (cookie.domain ?? host).replace(/^\./, '');
      const path =
        cookie.path ??
        (response.path.slice(0, response.path.lastIndexOf('/')) || '/');
      const retained = final.cookies.some(
        (item) =>
          item.name === cookie.name &&
          item.path === path &&
          item.domain.replace(/^\./, '') === domain,
      );
      if (!cookie.deletion && !retained)
        findings.push({
          kind: 'cookie_not_retained',
          name: cookie.name,
          response: {
            method: response.method,
            path: response.path,
            status: response.status,
          },
        });
    }
  }
  for (const delta of record.changes
    .filter(near)
    .sort(
      (a, b) =>
        Number(b.type === 'cookie' && b.change === 'removed') -
          Number(a.type === 'cookie' && a.change === 'removed') || b.at - a.at,
    )) {
    if (delta.type === 'storage')
      findings.push({
        kind: 'storage_changed',
        key: delta.storage.key,
        area: delta.storage.area,
        ...(delta.stepIndex !== null ? { step: delta.stepIndex } : {}),
      });
    else
      findings.push({
        kind:
          delta.change === 'removed'
            ? 'cookie_removed'
            : delta.change === 'value_changed'
              ? 'cookie_value_changed'
              : delta.change === 'metadata_changed'
                ? 'cookie_metadata_changed'
                : 'cookie_added',
        name: delta.cookie.name,
        ...(delta.stepIndex !== null ? { step: delta.stepIndex } : {}),
      });
  }
  if (auth?.type === 'http')
    findings.push({
      kind: 'auth_http_failure',
      response: { method: auth.method, path: auth.path, status: auth.status },
      cookiePresent: Boolean(final?.cookies.length),
    });
  const unique = [
    ...new Map(findings.map((item) => [JSON.stringify(item), item])).values(),
  ].slice(0, 3);
  while (Buffer.byteLength(JSON.stringify({ findings: unique })) >= 750)
    unique.pop();
  return unique.length ? { findings: unique } : undefined;
}

export function sanitizeSessionRecord(
  record: SessionRecord,
  redact: (value: string) => string,
): SessionRecord {
  return {
    truncated: record.truncated,
    snapshots: record.snapshots.map((snapshot) => ({
      at: snapshot.at,
      stepIndex: snapshot.stepIndex,
      cookiesComplete: snapshot.cookiesComplete,
      storageComplete: snapshot.storageComplete,
      cookies: snapshot.cookies.map((cookie) => sanitizeCookie(cookie, redact)),
      storage: snapshot.storage.map((item) => sanitizeStorage(item, redact)),
    })),
    changes: record.changes.map((change) =>
      change.type === 'cookie'
        ? {
            at: change.at,
            stepIndex: change.stepIndex,
            type: 'cookie',
            change: change.change,
            cookie: sanitizeCookie(change.cookie, redact),
          }
        : {
            at: change.at,
            stepIndex: change.stepIndex,
            type: 'storage',
            change: change.change,
            storage: sanitizeStorage(change.storage, redact),
          },
    ),
    responses: record.responses.map((response) => ({
      at: response.at,
      stepIndex: response.stepIndex,
      method: redact(response.method).slice(0, 16),
      path: redact(response.path).slice(0, 160),
      origin: redact(response.origin).slice(0, 200),
      status: response.status,
      cookies: response.cookies.map((cookie) => ({
        name: redact(cookie.name).slice(0, 80),
        deletion: cookie.deletion,
        ...(cookie.domain
          ? { domain: redact(cookie.domain).slice(0, 128) }
          : {}),
        ...(cookie.path ? { path: redact(cookie.path).slice(0, 128) } : {}),
      })),
    })),
  };
}
