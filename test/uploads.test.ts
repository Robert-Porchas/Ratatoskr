import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DirectoryUploadResolver } from '../src/uploads.js';

describe('upload resolver', () => {
  it('allows only regular files directly inside the configured directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'upload-test-'));
    const outside = await mkdtemp(join(tmpdir(), 'upload-outside-'));
    try {
      await writeFile(join(root, 'fixture.txt'), 'safe');
      await writeFile(join(outside, 'secret.txt'), 'private');
      await symlink(join(outside, 'secret.txt'), join(root, 'escape.txt'));
      const resolver = new DirectoryUploadResolver(root);
      expect(await resolver.resolve('fixture.txt')).toBe(
        join(root, 'fixture.txt'),
      );
      await expect(resolver.resolve('../secret.txt')).rejects.toThrow();
      await expect(resolver.resolve('escape.txt')).rejects.toThrow();
      await expect(resolver.resolve('missing.txt')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
