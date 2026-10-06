import { z } from 'zod';
import { distribution } from './matrix-summary.js';
import { median } from './metrics.js';
import type { DiagnosisReport } from './metrics.js';
import { ResultSchema, parseResults } from './metrics.js';
import type { AuthScenario } from '../../test/fixture/session.js';

export const SessionCaseSchema = z.enum(['direct', 'without', 'with']);
const count = z.number().int().nonnegative();
export const SessionResultSchema = ResultSchema.extend({
  sessionCase: SessionCaseSchema,
  expectedCases: z.array(SessionCaseSchema).min(1).max(3),
  expectedRuns: count.min(1),
  sessionInspectionCalls: count,
  sessionArtifactRequests: count,
  inspectCalls: count,
  artifactCalls: count,
  sessionInspectionBytes: count,
  compactFailureBytes: count,
  workflowDurationMs: z.number().nonnegative(),
  sessionMetrics: z
    .object({
      sessionSnapshotsCaptured: count,
      cookieCountObserved: count,
      cookieDeltasDetected: count,
      storageKeyDeltasDetected: count,
      sessionFindingsReturned: count,
      sessionFindingBytes: count,
      rawLocalSessionEvidenceBytes: count,
      sensitiveArtifactsCreated: count,
      captureDurationMs: z.number().nonnegative(),
      diffDurationMs: z.number().nonnegative(),
    })
    .optional(),
});
export type SessionBenchmarkResult = z.infer<typeof SessionResultSchema>;
export function parseSessionResults(raw: string): SessionBenchmarkResult[] {
  parseResults(raw);
  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => SessionResultSchema.parse(JSON.parse(line)));
}

export function sessionTask(scenario: AuthScenario) {
  const prompt = `Open the account page, sign in and verify the sign-in is accepted. Open Account details and verify Account active, then open Settings and verify Settings ready. ${scenario === 'loss' ? 'Sign out and verify Signed out, then ' : ''}Open the dashboard and verify Dashboard ready. ${scenario === 'unrelated' ? 'Then verify the Download report button is visible. ' : ''}If it fails, determine what changed in the browser session and report relevant HTTP and cookie evidence.${scenario === 'scope' ? ' Identify whether the session cookie path covers the protected request and cite that path.' : ''}`;
  return {
    prompt,
    plannedSteps: scenario === 'loss' ? 10 : scenario === 'unrelated' ? 9 : 8,
    sourceContext:
      'Source contract: route /auth; buttons Sign in, Account details, Settings, Sign out, Open dashboard. Sign in acceptance is role=status text Sign-in accepted. Account details confirmation is testId=detail text Account active. Settings confirmation is testId=settings text Settings ready. Sign out confirmation is role=status text Signed out. Dashboard confirmation is testId=dashboard text Dashboard ready. API routes: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/protected. These are application contracts, not statements that this run succeeds. Use report.persisted for verified dashboard access. For success use errorCode NONE; for a missing control use LOCATOR_NOT_FOUND with status 0. For HTTP failures report the observed response error code. Stop when evidence supports the requested facts; describe observations, not speculative root causes. Header listings may omit credential-bearing headers: absence there does not prove the server sent none. Do not guess cookie values or causes.',
  };
}

/** Grade actual server activity AND evidence exposed to the model, not fixture implementation knowledge. */
export function gradeSession(
  scenario: AuthScenario,
  requests: Array<{ method: string; path: string; status: number }>,
  report: DiagnosisReport | undefined,
  observed: string,
) {
  const failed = scenario !== 'success';
  const authFailure =
    scenario === 'missing' || scenario === 'loss' || scenario === 'scope';
  const explanation = report?.evidence.join(' ') ?? '';
  const falseHeaderClaim =
    /(?:contained|sent|returned|included)\s+no\s+set-cookie|(?:server|login response).{0,40}(?:did not|didn't|never)\s+(?:send|set)/i.test(
      explanation,
    );
  const diagnosis = Boolean(
    report &&
    !falseHeaderClaim &&
    (authFailure
      ? report.persisted === false &&
        report.method === 'GET' &&
        report.path === '/api/auth/protected' &&
        report.status === 401 &&
        report.errorCode === 'UNAUTHENTICATED' &&
        (scenario === 'missing'
          ? /cookie_not_retained|No cookies found|"cookies":\s*\[\]/i.test(
              observed,
            ) &&
            /not.retained|not.persist|not.stored|absent|missing|reject|no.*cookie/i.test(
              explanation,
            )
          : scenario === 'loss'
            ? /cookie_removed|"change":"removed"|No cookies found/i.test(
                observed,
              ) && /remov|delet|clear|logout|sign.out/i.test(explanation)
            : /\/restricted/.test(observed) && /\/restricted/.test(explanation))
      : scenario === 'success'
        ? report.persisted === true && report.errorCode === 'NONE'
        : report.errorCode === 'LOCATOR_NOT_FOUND' &&
          /Download report/i.test(observed)),
  );
  const criteria = {
    opened: requests.some((request) => request.path === '/auth'),
    signedIn: requests.some(
      (request) =>
        request.method === 'POST' &&
        request.path === '/api/auth/login' &&
        request.status === 200,
    ),
    account: requests.some((request) => request.path === '/api/auth/account'),
    settings: requests.some((request) => request.path === '/api/auth/settings'),
    dashboardAttempted: requests.some(
      (request) =>
        request.path === '/api/auth/protected' &&
        request.status === (authFailure ? 401 : 200),
    ),
    signedOut:
      scenario !== 'loss' ||
      requests.some((request) => request.path === '/api/auth/logout'),
    noFalseSuccess: authFailure
      ? report?.persisted === false
      : !failed
        ? report?.persisted === true
        : report?.errorCode === 'LOCATOR_NOT_FOUND',
    diagnosed: diagnosis,
  };
  return {
    criteria,
    diagnosisCorrect: diagnosis,
    success: Object.values(criteria).every(Boolean),
  };
}

export function summarizeSessions(rows: SessionBenchmarkResult[]): string {
  rows = parseSessionResults(rows.map((row) => JSON.stringify(row)).join('\n'));
  if (!rows.length) throw new Error('No session benchmark rows');
  if (
    new Set(
      rows.map(
        (row) =>
          `${row.configurationHash}:${row.gitCommit}:${row.model}:${row.codexVersion}:${row.browserVersion}:${row.tokenSource}`,
      ),
    ).size !== 1
  )
    throw new Error('Mixed session configurations');
  if (
    new Set(rows.map((row) => `${row.scenario}:${row.sessionCase}:${row.run}`))
      .size !== rows.length
  )
    throw new Error('Duplicate session rows');
  const fmt = (value: number | null) =>
    value === null
      ? 'N/A'
      : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
  let text = `# Session diagnostic token comparison\n\nCodex-reported turn.completed.usage from fresh isolated tasks. Total=input+output; cache and reasoning are subsets. No byte-to-token conversion. All failures remain in statistics. Model: ${rows[0]!.model}; Codex: ${rows[0]!.codexVersion}; browser: ${rows[0]!.browserVersion}; commit: ${rows[0]!.gitCommit}; started: ${rows[0]!.timestamp}.\n\n| Scenario | Case | Runs | Median tokens | Min–max | Mean ± SD | Median calls | Inspect calls | Invalid | Success | Diagnosis |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
  for (const scenario of [...new Set(rows.map((row) => row.scenario))]) {
    const groups = [
      ...new Set(
        rows
          .filter((row) => row.scenario === scenario)
          .map((row) => row.sessionCase),
      ),
    ].map((key) =>
      rows.filter(
        (row) => row.scenario === scenario && row.sessionCase === key,
      ),
    );
    if (
      groups.length !== rows[0]!.expectedCases.length ||
      groups.some((group) => group.length !== rows[0]!.expectedRuns) ||
      groups.some(
        (group) =>
          group.length !== groups[0]!.length ||
          group.some(
            (row) => !groups[0]!.some((other) => other.run === row.run),
          ),
      )
    )
      throw new Error('Unpaired session runs');
    for (const group of groups) {
      const tokens = group.every(
        (row) => row.tokenAuthoritative && row.totalTokens !== null,
      )
        ? distribution(group.map((row) => row.totalTokens!))
        : null;
      text += `| ${scenario} | ${group[0]!.sessionCase} | ${group.length} | ${fmt(tokens?.median ?? null)} | ${tokens ? `${fmt(tokens.min)}–${fmt(tokens.max)}` : 'N/A'} | ${tokens ? `${fmt(tokens.mean)} ± ${fmt(tokens.standardDeviation)}` : 'N/A'} | ${fmt(median(group.map((row) => row.toolInteractions)))} | ${fmt(median(group.map((row) => row.inspectCalls)))} | ${group.reduce((sum, row) => sum + (row.invalidToolCalls ?? 0), 0)} | ${group.filter((row) => row.success).length}/${group.length} | ${group.filter((row) => row.diagnosisCorrect).length}/${group.length} |\n`;
    }
    const withRows = groups.find((group) => group[0]?.sessionCase === 'with');
    const tokenMedian = (group: SessionBenchmarkResult[]) =>
      group.every((row) => row.tokenAuthoritative && row.totalTokens !== null)
        ? median(group.map((row) => row.totalTokens!))
        : null;
    if (withRows)
      for (const group of groups.filter((group) => group !== withRows)) {
        const a = tokenMedian(group),
          b = tokenMedian(withRows);
        text += `\n${scenario}: with versus ${group[0]!.sessionCase}: ${a === null || b === null || a === 0 ? 'N/A' : fmt((1 - b / a) * 100) + '% total-token reduction'}. Diagnostic correctness must be comparable.\n\n`;
      }
  }
  text +=
    '\n## Supporting medians (bytes are not tokens)\n\n| Scenario / case | Input / cached / uncached / output / reasoning tokens | Evidence bytes | Session L1 / L2 bytes | Capture / diff ms | Local session bytes | Schema bytes | Args bytes | Workflow ms |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n';
  for (const key of [
    ...new Set(rows.map((row) => `${row.scenario}/${row.sessionCase}`)),
  ]) {
    const group = rows.filter(
      (row) => `${row.scenario}/${row.sessionCase}` === key,
    );
    const value = (
      read: (row: SessionBenchmarkResult) => number | null | undefined,
    ) => {
      const values = group.map(read);
      return values.every((item) => typeof item === 'number')
        ? median(values as number[])
        : null;
    };
    text += `| ${key} | ${(['inputTokens', 'cachedInputTokens', 'uncachedInputTokens', 'outputTokens', 'reasoningTokens'] as const).map((field) => fmt(value((row) => row[field]))).join(' / ')} | ${fmt(value((row) => row.modelEvidenceBytes))} | ${fmt(value((row) => row.sessionMetrics?.sessionFindingBytes ?? 0))} / ${fmt(value((row) => row.sessionInspectionBytes))} | ${fmt(value((row) => row.sessionMetrics?.captureDurationMs ?? 0))} / ${fmt(value((row) => row.sessionMetrics?.diffDurationMs ?? 0))} | ${fmt(value((row) => row.sessionMetrics?.rawLocalSessionEvidenceBytes ?? 0))} | ${fmt(value((row) => row.toolDefinitionsBytes))} | ${fmt(value((row) => row.toolArgumentBytes))} | ${fmt(value((row) => row.workflowDurationMs))} |\n`;
  }
  return text;
}
