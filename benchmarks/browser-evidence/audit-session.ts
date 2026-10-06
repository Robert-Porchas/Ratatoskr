import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { authScenarios } from '../../test/fixture/session.js';
import { ReportSchema } from './metrics.js';
import { codexAccounting } from './usage.js';
import { measureCodexTools } from './codex-observations.js';
import {
  gradeSession,
  parseSessionResults,
  SessionCaseSchema,
  summarizeSessions,
} from './session-contract.js';

export const GradingAuditSchema = z.object({
  executionCommit: z.string().regex(/^[a-f0-9]{40}$/),
  verificationCommit: z.string().regex(/^[a-f0-9]{40}$/),
  verifiedTasks: z.number().int().positive(),
  reason: z.literal(
    'Accept cookie inspection after UI/HTTP failure, before body retrieval',
  ),
  changes: z.array(
    z.object({
      scenario: z.enum(authScenarios),
      sessionCase: SessionCaseSchema,
      run: z.number().int().positive(),
      previousSuccess: z.boolean(),
      verifiedSuccess: z.boolean(),
      previousDiagnosisCorrect: z.boolean(),
      verifiedDiagnosisCorrect: z.boolean(),
    }),
  ),
});

/** Regrade every task from original observations; never change native usage or source records. */
export async function auditSession(root: string) {
  const rows = parseSessionResults(
    await readFile(join(root, 'results.jsonl'), 'utf8'),
  );
  const changes: z.infer<typeof GradingAuditSchema>['changes'] = [];
  const verified = [];
  for (const row of rows) {
    const scenario = z.enum(authScenarios).parse(row.scenario);
    const directory = join(root, `${scenario}-${row.sessionCase}-${row.run}`);
    const events = (
      await readFile(join(directory, 'codex-events.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)));
    const usage = codexAccounting(events);
    for (const key of [
      'inputTokens',
      'cachedInputTokens',
      'uncachedInputTokens',
      'outputTokens',
      'reasoningTokens',
      'totalTokens',
    ] as const)
      if (usage[key] !== row[key])
        throw new Error(`Native usage mismatch: ${key}`);
    const tools = measureCodexTools(events);
    if (
      tools.interactions.length !== row.toolInteractions ||
      tools.toolArgumentBytes !== row.toolArgumentBytes ||
      tools.toolResultBytes !== row.toolResultBytes
    )
      throw new Error('Native tool count/byte mismatch');
    const { report } = z
      .object({ report: ReportSchema.nullable() })
      .parse(
        JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')),
      );
    const requests = z
      .array(
        z.object({ method: z.string(), path: z.string(), status: z.number() }),
      )
      .parse(
        JSON.parse(
          await readFile(join(directory, 'fixture-audit.json'), 'utf8'),
        ),
      );
    const observed = tools.interactions
      .map((item) => JSON.stringify(item.arguments) + '\n' + item.reply.text)
      .join('\n');
    const graded = gradeSession(
      scenario,
      requests,
      report ?? undefined,
      observed,
    );
    const success = !row.error && graded.success;
    if (
      success !== row.success ||
      graded.diagnosisCorrect !== row.diagnosisCorrect
    )
      changes.push({
        scenario,
        sessionCase: row.sessionCase,
        run: row.run,
        previousSuccess: row.success,
        verifiedSuccess: success,
        previousDiagnosisCorrect: row.diagnosisCorrect,
        verifiedDiagnosisCorrect: graded.diagnosisCorrect,
      });
    verified.push({ ...row, ...graded, success });
  }
  return {
    rows: verified,
    audit: GradingAuditSchema.parse({
      executionCommit: rows[0]?.gitCommit,
      verificationCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      verifiedTasks: rows.length,
      reason:
        'Accept cookie inspection after UI/HTTP failure, before body retrieval',
      changes,
    }),
  };
}

if (
  process.argv[1]?.endsWith('audit-session.ts') ||
  process.argv[1]?.endsWith('audit-session.js')
) {
  if (!process.argv[2]) throw new Error('Pass the session suite directory');
  const root = resolve(process.argv[2]);
  const { rows, audit } = await auditSession(root);
  await writeFile(
    join(root, 'audited-results.jsonl'),
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    { flag: 'wx' },
  );
  await writeFile(join(root, 'audited-summary.md'), summarizeSessions(rows), {
    flag: 'wx',
  });
  await writeFile(
    join(root, 'grading-audit.json'),
    JSON.stringify(audit, null, 2) + '\n',
    { flag: 'wx' },
  );
  process.stdout.write(
    `Audited ${rows.length} tasks; ${audit.changes.length} grades changed. Original files and all token/byte counts unchanged.\n`,
  );
}
