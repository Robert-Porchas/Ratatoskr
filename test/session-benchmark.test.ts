import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createSessionFixture } from './fixture/session.js';
import {
  gradeSession,
  parseSessionResults,
  sessionTask,
  summarizeSessions,
  type SessionBenchmarkResult,
} from '../benchmarks/browser-evidence/session-contract.js';
import { parseResults } from '../benchmarks/browser-evidence/metrics.js';

describe('session benchmark', () => {
  it('serves deterministic fake auth acceptance, rejection and cookie deletion', async () => {
    const fixture = createSessionFixture();
    fixture.server.listen(0, '127.0.0.1');
    await once(fixture.server, 'listening');
    try {
      const address = fixture.server.address();
      if (!address || typeof address === 'string')
        throw new Error('No address');
      const root = `http://127.0.0.1:${address.port}`;
      const page = await fetch(`${root}/auth`);
      expect(await page.text()).toContain('Dashboard closed');
      const login = await fetch(`${root}/api/auth/login?scenario=missing`, {
        method: 'POST',
      });
      expect(login.status).toBe(200);
      expect(login.headers.get('set-cookie')).toContain(
        'Domain=not-this-host.invalid',
      );
      const protectedResponse = await fetch(`${root}/api/auth/protected`);
      expect(protectedResponse.status).toBe(401);
      expect(await protectedResponse.json()).toEqual({
        error: 'UNAUTHENTICATED',
      });
      const logout = await fetch(`${root}/api/auth/logout`, { method: 'POST' });
      expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    } finally {
      fixture.server.closeAllConnections();
      await new Promise<void>((resolve) =>
        fixture.server.close(() => resolve()),
      );
    }
  });
  it('grades actual actions and diagnosis, not simply a completed workflow', () => {
    const requests = [
      '/auth',
      '/api/auth/login',
      '/api/auth/account',
      '/api/auth/settings',
      '/api/auth/protected',
    ].map((path) => ({
      path,
      method: path.endsWith('login') ? 'POST' : 'GET',
      status: path.endsWith('protected') ? 401 : 200,
    }));
    const report = {
      persisted: false,
      method: 'GET',
      path: '/api/auth/protected',
      status: 401,
      errorCode: 'UNAUTHENTICATED',
      evidence: ['session cookie was not retained after login'],
    };
    expect(
      gradeSession('missing', requests, report, 'cookie_not_retained').success,
    ).toBe(true);
    expect(
      gradeSession(
        'missing',
        requests,
        { ...report, persisted: true },
        'cookie_not_retained',
      ).success,
    ).toBe(false);
    expect(
      gradeSession('missing', requests, report, 'only status 401')
        .diagnosisCorrect,
    ).toBe(false);
    expect(
      gradeSession(
        'missing',
        requests,
        report,
        '{"cookies":[]} UNAUTHENTICATED',
      ).diagnosisCorrect,
    ).toBe(false);
    expect(
      gradeSession(
        'missing',
        requests,
        report,
        JSON.stringify({
          structuredContent: {
            sections: {
              session: { cookieSnapshot: { observedCount: 0, complete: true } },
            },
          },
        }),
      ).diagnosisCorrect,
    ).toBe(true);
    expect(
      gradeSession(
        'missing',
        requests,
        report,
        'No cookies found before login; UNAUTHENTICATED',
      ).diagnosisCorrect,
    ).toBe(false);
    expect(
      gradeSession(
        'missing',
        requests,
        {
          ...report,
          evidence: [
            'Login response contained no Set-Cookie; no cookies existed',
          ],
        },
        'No cookies found',
      ).diagnosisCorrect,
    ).toBe(false);
    expect(
      gradeSession('missing', requests.slice(1), report, 'cookie_not_retained')
        .success,
    ).toBe(false);
    expect(sessionTask('scope').prompt).toContain('cite that path');
  });
  it('uses real-usage fields and rejects missing, unpaired or malformed data', async () => {
    const base = parseResults(
      await readFile(
        'benchmarks/browser-evidence/codex-sample/results.jsonl',
        'utf8',
      ),
    )[0]!;
    const rows: SessionBenchmarkResult[] = (
      ['without', 'with', 'direct'] as const
    ).map((sessionCase, index) => ({
      ...base,
      scenario: 'missing',
      sessionCase,
      mode: sessionCase === 'direct' ? 'baseline' : 'ratatoskr',
      expectedCases: ['without', 'with', 'direct'],
      expectedRuns: 1,
      inputTokens: [180, 80, 380][index]!,
      outputTokens: 20,
      totalTokens: [200, 100, 400][index]!,
      cachedInputTokens: 0,
      uncachedInputTokens: [180, 80, 380][index]!,
      reasoningTokens: null,
      tokenAuthoritative: true,
      rawEvidenceBytes: 99999,
      modelEvidenceBytes: 88888,
      toolInteractions: 1,
      sessionInspectionCalls: 0,
      sessionArtifactRequests: 0,
      inspectCalls: 0,
      artifactCalls: 0,
      sessionInspectionBytes: 0,
      compactFailureBytes: 0,
      workflowDurationMs: 1,
    }));
    const summary = summarizeSessions(rows);
    expect(summary).toContain('50% total-token reduction');
    expect(summary).toContain('75% total-token reduction');
    expect(summary).toContain('88,888');
    expect(summary).toContain('Codex-reported turn.completed.usage');
    expect(() => summarizeSessions(rows.slice(1))).toThrow('Unpaired');
    expect(() => summarizeSessions([...rows, rows[0]!])).toThrow('Duplicate');
    expect(() =>
      parseSessionResults(JSON.stringify({ ...rows[0], totalTokens: 999 })),
    ).toThrow();
    expect(() =>
      summarizeSessions([
        { ...rows[0]!, totalTokens: null, tokenAuthoritative: false },
        rows[1]!,
        rows[2]!,
      ]),
    ).toThrow();
    const unavailable = rows.map((row) => ({
      ...row,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      tokenAuthoritative: false,
      cachedInputTokens: null,
      uncachedInputTokens: null,
      reasoningTokens: null,
    }));
    expect(summarizeSessions(unavailable)).toContain('N/A');
  });
});
