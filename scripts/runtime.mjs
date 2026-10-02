import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

export const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

export function installationHome(environment = process.env, home = homedir()) {
  return resolve(environment.RATATOSKR_HOME || join(home, '.ratatoskr'));
}

export function assertNode(version = process.versions.node) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || Number(version.split('.')[0]) < 22)
    throw new Error('Ratatoskr requires Node.js 22 or newer.');
}

export async function registeredRoot(environment = process.env) {
  const registry = join(installationHome(environment), 'runtime.json');
  const value = JSON.parse(await readFile(registry, 'utf8'));
  if (typeof value.root !== 'string' || !isAbsolute(value.root))
    throw new Error(
      'Invalid Ratatoskr runtime registration. Run npm run setup.',
    );
  return value.root;
}
