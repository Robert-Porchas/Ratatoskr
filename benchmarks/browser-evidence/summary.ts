import { readFile, writeFile } from 'node:fs/promises';
import { parseResults, summarize } from './metrics.js';

const source = process.argv[2];
if (!source)
  throw new Error(
    'Usage: benchmark:browser:summary <results.jsonl> [summary.md]',
  );
const summary = summarize(parseResults(await readFile(source, 'utf8')));
if (process.argv[3]) await writeFile(process.argv[3], summary);
process.stdout.write(summary);
