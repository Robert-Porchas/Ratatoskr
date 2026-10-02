import { readFileSync } from 'node:fs';

// The package is the version source in both source and compiled layouts.
const source = new URL('../package.json', import.meta.url);
const compiled = new URL('../../package.json', import.meta.url);
let metadata: unknown;
try {
  metadata = JSON.parse(readFileSync(source, 'utf8'));
} catch {
  metadata = JSON.parse(readFileSync(compiled, 'utf8'));
}
if (
  !metadata ||
  typeof metadata !== 'object' ||
  !('name' in metadata) ||
  metadata.name !== 'ratatoskr' ||
  !('version' in metadata) ||
  typeof metadata.version !== 'string'
)
  throw new Error('Ratatoskr package metadata is missing');
export const VERSION = metadata.version;
