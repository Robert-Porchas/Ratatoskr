import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditMatrix } from '../benchmarks/browser-evidence/audit-matrix.js';
import { parseResults } from '../benchmarks/browser-evidence/metrics.js';

it('audits usage and method/path without changing original records or inventing token totals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ratatoskr-audit-test-'));
  try {
    const original = parseResults(
      await readFile(
        'benchmarks/browser-evidence/codex-sample/results.jsonl',
        'utf8',
      ),
    )[0]!;
    const row = {
      ...original,
      scenario: 'medium-http_failure',
      baselineId: 'playwright' as const,
      toolInteractions: 0,
      toolArgumentBytes: 0,
      toolResultBytes: 0,
      invalidToolCalls: 1,
    };
    const source = JSON.stringify(row) + '\n';
    await writeFile(join(root, 'results.jsonl'), source);
    const directory = join(
      root,
      `${row.scenario}-${row.baselineId}-${row.mode}-${row.run}`,
    );
    await mkdir(directory);
    await writeFile(
      join(directory, 'codex-events.jsonl'),
      [
        { type: 'thread.started', thread_id: row.codexThreadId },
        { type: 'turn.started' },
        {
          type: 'turn.completed',
          usage: {
            input_tokens: row.inputTokens,
            output_tokens: row.outputTokens,
            cached_input_tokens: row.cachedInputTokens,
            reasoning_output_tokens: row.reasoningTokens,
          },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n'),
    );
    await writeFile(
      join(directory, 'report.json'),
      JSON.stringify({
        report: {
          persisted: false,
          method: 'GET',
          path: '/wrong',
          status: 500,
          errorCode: 'INTERNAL_ERROR',
          evidence: ['test-only verdict'],
        },
      }),
    );
    const [audited] = await auditMatrix(root);
    expect(audited?.totalTokens).toBe(row.totalTokens);
    expect(audited?.success).toBe(false);
    expect(audited?.invalidToolCalls).toBe(0);
    expect(await readFile(join(root, 'results.jsonl'), 'utf8')).toBe(source);
    await writeFile(
      join(root, 'results.jsonl'),
      JSON.stringify({ ...row, totalTokens: row.totalTokens! + 1 }),
    );
    await expect(auditMatrix(root)).rejects.toThrow('Invalid');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
