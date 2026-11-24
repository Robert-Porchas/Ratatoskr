import { constants } from 'node:fs';
import { open, realpath, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, isAbsolute } from 'node:path';

export async function readBoundedFile(
  path: string,
  maxBytes = 256_000,
): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes)
      throw new Error('Input must be a bounded regular file');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxBytes) throw new Error('Input exceeds file budget');
    return buffer.subarray(0, size).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** Caller chooses an existing workspace directory; never overwrite or follow a file symlink. */
export async function writeNewWorkspaceFile(
  path: string,
  content: string,
  workspace = process.cwd(),
): Promise<void> {
  const boundary = await realpath(workspace);
  const destination = resolve(workspace, path);
  const parent = await realpath(dirname(destination));
  const inside = relative(boundary, parent);
  if (
    inside === '..' ||
    inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(inside)
  )
    throw new Error('Output directory must be inside the workspace');
  await writeFile(
    resolve(parent, destination.slice(dirname(destination).length + 1)),
    content,
    { flag: 'wx', mode: 0o600 },
  );
}
