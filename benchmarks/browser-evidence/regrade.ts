import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { observedFailure } from './agent.js';
import { parseResults, summarize } from './metrics.js';

// Re-evaluate preserved evidence after a scoring correction; never overwrite raw results.
const source = process.argv[2];
const destination = process.argv[3];
if (!source || !destination)
  throw new Error(
    'Usage: regrade <original-results.jsonl> <new-results.jsonl>',
  );
const rows = parseResults(await readFile(source, 'utf8'));
for (const row of rows) {
  const directory = join(dirname(source), `${row.mode}-${row.run}`);
  const replies = (
    await readFile(join(directory, 'interactions.jsonl'), 'utf8')
  )
    .trim()
    .split('\n')
    .map((line) => {
      const parsed = z
        .object({ reply: z.object({ text: z.string() }) })
        .parse(JSON.parse(line));
      return parsed.reply.text;
    });
  const report = z
    .object({ report: z.object({ persisted: z.boolean() }).nullable() })
    .parse(
      JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')),
    ).report;
  row.criteria.recognizedPersistenceFailure =
    report?.persisted === false && observedFailure(replies).persistenceFailure;
  row.success = !row.error && Object.values(row.criteria).every(Boolean);
  row.diagnosisCorrect = [
    'recognizedPersistenceFailure',
    'identifiedHttp500',
    'identifiedInternalError',
    'didNotClaimPersistence',
  ].every((criterion) => row.criteria[criterion]);
}
await writeFile(
  destination,
  rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
  { flag: 'wx' },
);
process.stdout.write(summarize(rows));
