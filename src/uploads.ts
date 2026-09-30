import { realpath, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { BridgeError } from './errors.js';

export interface UploadResolver {
  resolve(fileName: string): Promise<string>;
}

/** Resolve one basename inside a configured directory; symlinks may not escape it. */
export class DirectoryUploadResolver implements UploadResolver {
  constructor(private readonly root: string | undefined) {}

  async resolve(fileName: string): Promise<string> {
    if (!this.root)
      throw new BridgeError(
        'browser_execution',
        'Upload directory is not configured',
      );
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(fileName) ||
      fileName === '..'
    )
      throw new BridgeError('browser_execution', 'Invalid upload filename');
    try {
      const directory = await realpath(this.root);
      const file = await realpath(resolve(directory, fileName));
      if (dirname(file) !== directory || !(await stat(file)).isFile())
        throw new Error('outside allowed directory');
      return file;
    } catch {
      throw new BridgeError(
        'browser_execution',
        'Upload file is unavailable or outside the allowed directory',
      );
    }
  }
}
