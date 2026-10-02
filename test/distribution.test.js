import { describe, expect, it } from 'vitest';
import { assertNode, installationHome } from '../scripts/runtime.mjs';
import { VERSION } from '../src/version.js';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('distribution boundaries', () => {
  it('uses a user-owned directory independent of installation cwd', () => {
    expect(installationHome({}, '/tmp/home with spaces')).toBe(
      resolve('/tmp/home with spaces/.ratatoskr'),
    );
    expect(installationHome({ RATATOSKR_HOME: '/tmp/custom home' })).toBe(
      resolve('/tmp/custom home'),
    );
  });
  it('rejects unsupported Node versions', () => {
    expect(() => assertNode('20.19.0')).toThrow('22');
    expect(() => assertNode('invalid')).toThrow('22');
    expect(() => assertNode('22.0.0')).not.toThrow();
    expect(() => assertNode('24.0.0')).not.toThrow();
  });
  it('reads the release version from package metadata', () => {
    const metadata = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    );
    expect(VERSION).toBe(metadata.version);
    expect(metadata.license).toBe('MIT');
    expect(metadata.engines.node).toBe('>=22');
  });
});
