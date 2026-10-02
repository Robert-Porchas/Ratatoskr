import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { VERSION } from '../src/version.js';

it('advertises the package release version', () => {
  const metadata: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(metadata).toMatchObject({ name: 'ratatoskr', version: VERSION });
});
