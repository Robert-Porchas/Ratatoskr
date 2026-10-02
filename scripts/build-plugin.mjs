import { copyFile, cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from './runtime.mjs';

// Stage only distributable components: local marketplaces copy their source tree.
const destination = join(projectRoot, 'dist/plugin');
await mkdir(join(destination, 'scripts'), { recursive: true });
for (const directory of ['.codex-plugin', 'skills'])
  await cp(join(projectRoot, directory), join(destination, directory), {
    recursive: true,
  });
for (const file of ['.mcp.json', 'scripts/mcp.mjs', 'scripts/runtime.mjs'])
  await copyFile(join(projectRoot, file), join(destination, file));
