import { describe, expect, it } from 'vitest';
import {
  diffSessions,
  observeSetCookie,
  reduceSession,
  sanitizeCookie,
  sanitizeSessionRecord,
  SessionJournal,
  type SessionSnapshot,
  type CookieMetadata,
  type SessionRecord,
} from '../src/session.js';
import type { StepResult } from '../src/protocol.js';

const cookie: CookieMetadata = {
  name: 'session',
  domain: 'localhost',
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: false,
  sameSite: 'Lax',
};
const snapshot = (
  cookies: SessionSnapshot['cookies'] = [],
  storage: SessionSnapshot['storage'] = [],
): SessionSnapshot => ({
  at: 1000,
  stepIndex: 2,
  cookies,
  storage,
  cookiesComplete: true,
  storageComplete: true,
  storageOrigins: ['http://localhost'],
});
const failed: StepResult = {
  index: 3,
  action: 'assert_url',
  status: 'failed',
  startedAt: 1100,
  endedAt: 2000,
  durationMs: 900,
};
const response = {
  at: 1000,
  stepIndex: 2,
  method: 'POST',
  path: '/api/login',
  origin: 'http://localhost',
  status: 200,
  cookies: [{ name: 'session', path: '/', deletion: false }],
};

describe('session comparison and sanitization', () => {
  it('distinguishes cookie identities including domain, path and partition', () => {
    const cookies = [
      cookie,
      { ...cookie, domain: 'other.test' },
      { ...cookie, path: '/app' },
      { ...cookie, partitionKey: 'https://site.test' },
    ].map((item) => ({ ...item, fingerprint: 'old' }));
    expect(diffSessions(snapshot(cookies), snapshot(cookies))).toEqual([]);
    const changes = diffSessions(snapshot(cookies), snapshot(cookies.slice(1)));
    expect(changes).toMatchObject([
      { change: 'removed', cookie: { domain: 'localhost', path: '/' } },
    ]);
  });
  it('classifies additions, removals, value and metadata changes', () => {
    const before = snapshot([{ ...cookie, fingerprint: 'old' }]);
    expect(diffSessions(snapshot(), before)[0]?.change).toBe('added');
    expect(diffSessions(before, snapshot())[0]?.change).toBe('removed');
    expect(
      diffSessions(before, snapshot([{ ...cookie, fingerprint: 'new' }]))[0]
        ?.change,
    ).toBe('value_changed');
    for (const metadata of [
      { expires: 1800000000 },
      { secure: true },
      { sameSite: 'Strict' as const },
      { httpOnly: false },
    ]) {
      expect(
        diffSessions(
          before,
          snapshot([{ ...cookie, ...metadata, fingerprint: 'old' }]),
        )[0]?.change,
      ).toBe('metadata_changed');
    }
  });
  it('compares storage by origin, key and area, never by value in persisted data', () => {
    const item = {
      origin: 'http://localhost',
      key: 'auth_state',
      area: 'local' as const,
      fingerprint: 'old',
    };
    expect(
      diffSessions(
        snapshot([], [item]),
        snapshot([], [{ ...item, fingerprint: 'new' }]),
      ),
    ).toMatchObject([
      {
        type: 'storage',
        change: 'value_changed',
        storage: { key: 'auth_state' },
      },
    ]);
    expect(diffSessions(snapshot(), snapshot([], [item]))[0]?.change).toBe(
      'added',
    );
    expect(diffSessions(snapshot([], [item]), snapshot())[0]?.change).toBe(
      'removed',
    );
    const other = {
      ...snapshot([], [item]),
      storageOrigins: ['http://other.test'],
    };
    expect(diffSessions(snapshot([], [item]), other)).toEqual([]);
    expect(
      diffSessions(snapshot([], [item]), {
        ...snapshot(),
        storageComplete: false,
      }),
    ).toEqual([]);
    expect(
      diffSessions(snapshot([{ ...cookie, fingerprint: 'old' }]), {
        ...snapshot(),
        cookiesComplete: false,
      }),
    ).toEqual([]);
  });
  it('strips injected values and fingerprints through the central allowlist', () => {
    const raw = {
      ...cookie,
      fingerprint: 'DO_NOT_PERSIST_HASH',
      value: 'SUPER_SECRET_SESSION_VALUE_123',
    };
    expect(JSON.stringify(sanitizeCookie(raw))).not.toContain('SECRET');
    const journal = new SessionJournal();
    journal.add(snapshot([raw]));
    expect(JSON.stringify(journal)).not.toContain('DO_NOT_PERSIST_HASH');
    const record = sanitizeSessionRecord(journal.record, (value) =>
      value.replaceAll('localhost', '[REDACTED]'),
    );
    expect(JSON.stringify(record)).not.toMatch(
      /SECRET|fingerprint|DO_NOT_PERSIST_HASH|localhost/,
    );
    expect(new SessionJournal().fingerprint('same')).not.toBe(
      journal.fingerprint('same'),
    );
  });
  it('observes individual Set-Cookie headers without persisting values or Expires commas', () => {
    const protectedValues: string[] = [];
    const parsed = observeSetCookie(
      'session=SUPER_SECRET_SESSION_VALUE_123; HttpOnly; Path=/; Expires=Wed, 01 Jan 2031 00:00:00 GMT',
      (value) => protectedValues.push(value),
    );
    expect(parsed).toEqual({ name: 'session', path: '/', deletion: false });
    expect(protectedValues).toEqual(['SUPER_SECRET_SESSION_VALUE_123']);
    expect(observeSetCookie('session=; Max-Age=0', () => {})).toMatchObject({
      deletion: true,
    });
    expect(observeSetCookie('bad header', () => {})).toBeUndefined();
  });
  it('correlates non-retention, removal and 401 while ignoring unrelated state', () => {
    const record: SessionRecord = {
      snapshots: [snapshot()],
      changes: [],
      responses: [response],
      truncated: false,
    };
    expect(reduceSession(record, failed, [])?.findings[0]).toMatchObject({
      kind: 'cookie_not_retained',
      name: 'session',
      response: { status: 200 },
    });
    record.responses[0]!.cookies[0]!.deletion = true;
    expect(reduceSession(record, failed, [])).toBeUndefined();
    record.changes = [
      { at: 1200, stepIndex: 2, type: 'cookie', change: 'removed', cookie },
    ];
    const reduced = reduceSession(record, failed, [
      {
        type: 'http',
        at: 1300,
        stepIndex: 2,
        method: 'GET',
        path: '/api/protected',
        status: 401,
      },
    ]);
    expect(reduced?.findings.map((item) => item.kind)).toEqual([
      'cookie_removed',
    ]);
    record.changes[0]!.at = -10000;
    expect(reduceSession(record, failed, [])).toBeUndefined();
    record.changes[0]!.at = 1000;
    record.changes[0]!.stepIndex = -1;
    expect(reduceSession(record, failed, [])).toBeUndefined();
  });
  it('does not infer absence from incomplete snapshots or other-domain/name collisions', () => {
    const record: SessionRecord = {
      snapshots: [{ ...snapshot(), cookiesComplete: false }],
      changes: [],
      responses: [
        {
          ...response,
          cookies: [{ name: 'session', path: '/', deletion: false }],
        },
      ],
      truncated: false,
    };
    expect(reduceSession(record, failed, [])).toBeUndefined();
    record.snapshots = [
      snapshot([{ ...cookie, domain: 'other.test', fingerprint: 'x' }]),
    ];
    expect(reduceSession(record, failed, [])?.findings[0]?.kind).toBe(
      'cookie_not_retained',
    );
  });
  it('does not mislabel a later logout as cookie non-retention', () => {
    const before = {
      ...snapshot([{ ...cookie, fingerprint: 'old' }]),
      at: 1050,
    };
    const after = { ...snapshot(), at: 1500 };
    const record: SessionRecord = {
      snapshots: [before, after],
      changes: [],
      responses: [response],
      truncated: false,
    };
    expect(reduceSession(record, failed, [])).toBeUndefined();
  });
  it('handles redacted origins defensively and case-insensitive cookie domains', () => {
    const record: SessionRecord = {
      snapshots: [snapshot()],
      changes: [],
      responses: [{ ...response, origin: '[REDACTED]' }],
      truncated: false,
    };
    expect(reduceSession(record, failed, [])).toBeUndefined();
    record.responses = [
      {
        ...response,
        cookies: [
          { name: 'session', domain: 'LOCALHOST', path: '/', deletion: false },
        ],
      },
    ];
    record.snapshots = [snapshot([{ ...cookie, fingerprint: 'x' }])];
    expect(reduceSession(record, failed, [])).toBeUndefined();
  });
  it('does not compare sessionStorage across active tabs', () => {
    const item = {
      origin: 'http://localhost',
      key: 'auth_state',
      area: 'session' as const,
      fingerprint: 'old',
    };
    expect(
      diffSessions(
        { ...snapshot([], [item]), tabId: 1 },
        { ...snapshot(), tabId: 2 },
      ),
    ).toEqual([]);
  });
  it('bounds findings, local retention and serialized Level 1 size', () => {
    const journal = new SessionJournal();
    for (let index = 0; index < 100; index++)
      journal.add(snapshot([{ ...cookie, fingerprint: String(index) }]));
    expect(journal.record.snapshots.length).toBe(64);
    expect(journal.record.truncated).toBe(true);
    const result = reduceSession(journal.record, failed, []);
    expect(result?.findings.length).toBeLessThanOrEqual(3);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(750);
  });
});
