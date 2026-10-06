import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  parseSessionResults,
  summarizeSessions,
} from '../benchmarks/browser-evidence/session-contract.js';
import { codexAccounting } from '../benchmarks/browser-evidence/usage.js';
import { GradingAuditSchema } from '../benchmarks/browser-evidence/audit-session.js';
import {
  FAKE_SESSION_SECRET,
  FAKE_STORAGE_SECRET,
  FAKE_HEADER_SECRET,
} from './fixture/session.js';

const root = 'benchmarks/browser-evidence/session-observability';
describe('published session measurements', () => {
  it('regenerates all archived summaries from complete paired count records and native usage', async () => {
    const folders = [
      root,
      ...(await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, entry.name)),
    ];
    let archives = 0;
    for (const folder of folders) {
      if (!(await readdir(folder)).includes('results.jsonl')) continue;
      archives++;
      const jsonl = await readFile(join(folder, 'results.jsonl'), 'utf8');
      const rows = parseSessionResults(jsonl);
      const rawConfiguration: unknown = JSON.parse(
        await readFile(join(folder, 'configuration.json'), 'utf8'),
      );
      const configuration = z
        .object({
          runs: z.number().int().positive(),
          cases: z.array(z.string()),
          scenarios: z.array(z.string()),
          directScenarios: z.array(z.string()),
        })
        .parse(rawConfiguration);
      const expectedRows = configuration.scenarios.reduce(
        (sum, scenario) =>
          sum +
          configuration.runs *
            configuration.cases.filter(
              (key) =>
                key !== 'direct' ||
                configuration.directScenarios.includes(scenario),
            ).length,
        0,
      );
      expect(rows).toHaveLength(expectedRows);
      expect(
        rows.every(
          (row) =>
            row.configurationHash ===
            createHash('sha256')
              .update(JSON.stringify(rawConfiguration))
              .digest('hex'),
        ),
      ).toBe(true);
      expect(await readFile(join(folder, 'summary.md'), 'utf8')).toBe(
        summarizeSessions(rows),
      );
      if ((await readdir(folder)).includes('grading-audit.json')) {
        const audit = GradingAuditSchema.parse(
          JSON.parse(
            await readFile(join(folder, 'grading-audit.json'), 'utf8'),
          ),
        );
        expect(audit.verifiedTasks).toBe(rows.length);
        expect(audit.executionCommit).toBe(rows[0]?.gitCommit);
        const originals = rows.map((row) => {
          const change = audit.changes.find(
            (item) =>
              item.scenario === row.scenario &&
              item.sessionCase === row.sessionCase &&
              item.run === row.run,
          );
          if (!change) return row;
          expect(row.success).toBe(change.verifiedSuccess);
          expect(row.diagnosisCorrect).toBe(change.verifiedDiagnosisCorrect);
          return {
            ...row,
            success: change.previousSuccess,
            diagnosisCorrect: change.previousDiagnosisCorrect,
            criteria: {
              ...row.criteria,
              diagnosed: change.previousDiagnosisCorrect,
            },
          };
        });
        expect(
          await readFile(join(folder, 'original-summary.md'), 'utf8'),
        ).toBe(summarizeSessions(originals));
      }
      const usage = (await readFile(join(folder, 'native-usage.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) =>
          z
            .object({
              scenario: z.string(),
              sessionCase: z.string(),
              run: z.number(),
              usage: z.record(z.string(), z.number()).nullable(),
            })
            .parse(JSON.parse(line)),
        );
      expect(usage).toHaveLength(rows.length);
      for (const row of rows) {
        const native = usage.find(
          (item) =>
            item.scenario === row.scenario &&
            item.sessionCase === row.sessionCase &&
            item.run === row.run,
        );
        expect(native).toBeDefined();
        const accounting = codexAccounting(
          native?.usage
            ? [
                { type: 'thread.started' },
                { type: 'turn.started' },
                { type: 'turn.completed', usage: native.usage },
              ]
            : [],
        );
        for (const key of [
          'inputTokens',
          'cachedInputTokens',
          'uncachedInputTokens',
          'outputTokens',
          'reasoningTokens',
          'totalTokens',
        ] as const)
          expect(row[key]).toBe(accounting[key]);
        expect(row).not.toHaveProperty('codexThreadId');
      }
      for (const secret of [
        FAKE_SESSION_SECRET,
        FAKE_STORAGE_SECRET,
        FAKE_HEADER_SECRET,
      ])
        expect(jsonl).not.toContain(secret);
      expect(jsonl).not.toContain('fingerprint');
    }
    expect(archives).toBeGreaterThan(0);
  });
});
