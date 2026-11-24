import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { readBoundedFile, writeNewWorkspaceFile } from '../src/local-files.js';

it('bounds reads and refuses overwrite, traversal, and external symlink writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ratatoskr-files-'));
  try {
    const workspace = join(root, 'workspace');
    const outside = join(root, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    await writeNewWorkspaceFile('test.spec.ts', 'safe', workspace);
    await expect(
      writeNewWorkspaceFile('test.spec.ts', 'changed', workspace),
    ).rejects.toThrow();
    await expect(
      writeNewWorkspaceFile('../outside/new.ts', 'unsafe', workspace),
    ).rejects.toThrow('inside the workspace');
    await symlink(
      outside,
      join(workspace, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      writeNewWorkspaceFile('linked/new.ts', 'unsafe', workspace),
    ).rejects.toThrow('inside the workspace');
    expect(await readFile(join(workspace, 'test.spec.ts'), 'utf8')).toBe(
      'safe',
    );
    await expect(
      readBoundedFile(join(workspace, 'test.spec.ts'), 2),
    ).rejects.toThrow('bounded regular file');
    await writeFile(join(workspace, 'input'), '1234');
    expect(await readBoundedFile(join(workspace, 'input'), 4)).toBe('1234');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
