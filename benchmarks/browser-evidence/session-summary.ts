import { readFile, writeFile } from 'node:fs/promises';
import { parseSessionResults, summarizeSessions } from './session-contract.js';
const file = process.argv[2];
if (!file) throw new Error('Pass a session results.jsonl file');
const raw = await readFile(file, 'utf8');
const summary = summarizeSessions(parseSessionResults(raw));
if (process.argv[3]) await writeFile(process.argv[3], summary);
process.stdout.write(summary);
