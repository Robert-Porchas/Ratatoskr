import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseSessionResults, summarizeSessions } from './session-contract.js';
import { parseResults } from './metrics.js';
import { codexAccounting } from './usage.js';
import { z } from 'zod';

const currentFile = process.argv[2];
const preFile = process.argv[3];
if (!currentFile || !preFile)
  throw new Error('Pass session results.jsonl and pre-change results.jsonl');
const label = process.argv[4];
if (label && !/^[a-zA-Z0-9_-]+$/.test(label))
  throw new Error('Invalid publication label');
const destination = join(
  'benchmarks/browser-evidence/session-observability',
  label ?? '',
);
const rows = parseSessionResults(await readFile(currentFile, 'utf8'));
const pre = parseResults(await readFile(preFile, 'utf8'));
const usage: unknown[] = [];
for (const row of rows) {
  const directory = join(
    dirname(currentFile),
    `${row.scenario}-${row.sessionCase}-${row.run}`,
  );
  const events = (await readFile(join(directory, 'codex-events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const accounted = codexAccounting(events);
  for (const key of [
    'inputTokens',
    'cachedInputTokens',
    'uncachedInputTokens',
    'outputTokens',
    'reasoningTokens',
    'totalTokens',
  ] as const)
    if (accounted[key] !== row[key])
      throw new Error(
        `Native usage mismatch: ${row.scenario}/${row.sessionCase}/${row.run}/${key}`,
      );
  usage.push({
    scenario: row.scenario,
    sessionCase: row.sessionCase,
    run: row.run,
    usage: (() => {
      const raw = events.find(
        (event) => event.type === 'turn.completed',
      )?.usage;
      if (!raw || typeof raw !== 'object') return null;
      return Object.fromEntries(
        Object.entries(raw).filter(
          ([key, value]) =>
            [
              'input_tokens',
              'cached_input_tokens',
              'cache_write_input_tokens',
              'output_tokens',
              'reasoning_output_tokens',
              'total_tokens',
            ].includes(key) && typeof value === 'number',
        ),
      );
    })(),
  });
}
const safe = <T extends { codexThreadId?: string | undefined }>(row: T) => {
  const copy = { ...row };
  delete copy.codexThreadId;
  return copy;
};
await mkdir(destination, { recursive: true });
await writeFile(
  join(destination, 'results.jsonl'),
  rows.map((row) => JSON.stringify(safe(row))).join('\n') + '\n',
);
await writeFile(
  join(destination, 'native-usage.jsonl'),
  usage.map((row) => JSON.stringify(row)).join('\n') + '\n',
);
await writeFile(
  join(destination, 'pre-change.json'),
  JSON.stringify(pre.map(safe), null, 2) + '\n',
);
await writeFile(
  join(destination, 'configuration.json'),
  await readFile(join(dirname(currentFile), 'configuration.json')),
);
await writeFile(join(destination, 'summary.md'), summarizeSessions(rows));
try {
  const number = z.number().nonnegative();
  const stats = z.object({
    median: number,
    min: number,
    max: number,
    mean: number,
    standardDeviation: number,
  });
  const timing = z
    .object({
      runs: number.int().positive(),
      timeoutMs: number.int().positive(),
      rows: z.array(
        z.object({
          mode: z.enum(['before', 'after']),
          scenario: z.enum(['success', 'missing']),
          run: number.int().positive(),
          workflowMs: number,
          captureMs: number.nullable(),
          diffMs: number.nullable(),
          compactResultBytes: number.int(),
          sessionBytes: number.int(),
        }),
      ),
      groups: z.array(
        z.object({
          key: z.string().regex(/^(success|missing)\/(before|after)$/),
          durationMs: stats,
        }),
      ),
    })
    .parse(
      JSON.parse(
        await readFile(join(dirname(currentFile), 'timing.json'), 'utf8'),
      ),
    );
  await writeFile(
    join(destination, 'timing.json'),
    JSON.stringify(timing, null, 2) + '\n',
  );
} catch (error) {
  if (
    !error ||
    typeof error !== 'object' ||
    !('code' in error) ||
    error.code !== 'ENOENT'
  )
    throw error;
}
process.stdout.write(
  `Published verified counts only (no tool bodies, browser artifacts, session IDs or credentials): ${destination}\n`,
);
