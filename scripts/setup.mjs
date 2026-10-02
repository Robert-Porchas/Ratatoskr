import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertNode, installationHome, projectRoot } from './runtime.mjs';

try {
  assertNode();
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--value-refs'))
    throw new Error(
      'Usage: npm run setup [-- --value-refs TEST_EMAIL,TEST_PASSWORD]',
    );
  const valueRefs = args.length ? args[1].split(',') : [];
  if (valueRefs.some((ref) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)))
    throw new Error('Value references must be environment variable names.');
  for (const args of [
    [
      join(projectRoot, 'node_modules/typescript/bin/tsc'),
      '-p',
      'tsconfig.json',
    ],
    [join(projectRoot, 'scripts/build-plugin.mjs')],
    [
      join(projectRoot, 'node_modules/playwright/cli.js'),
      'install',
      'chromium',
    ],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    if (result.error || result.status !== 0)
      throw new Error(
        'Setup failed. Install dependencies with npm ci; see README troubleshooting.',
      );
  }
  await import(new URL('../dist/src/mcp/server.js', import.meta.url));
  const mcpPath = join(projectRoot, 'dist/plugin/.mcp.json');
  const mcp = JSON.parse(await readFile(mcpPath, 'utf8'));
  mcp.mcpServers.ratatoskr.env_vars = [
    ...new Set([...mcp.mcpServers.ratatoskr.env_vars, ...valueRefs]),
  ];
  if (valueRefs.length)
    mcp.mcpServers.ratatoskr.env = {
      RATATOSKR_ALLOWED_VALUE_REFS: valueRefs.join(','),
    };
  await writeFile(mcpPath, JSON.stringify(mcp, null, 2) + '\n');
  const home = installationHome();
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(
    join(home, 'runtime.json'),
    JSON.stringify({ root: projectRoot }),
    { mode: 0o600 },
  );
  process.stdout.write(
    'Ratatoskr prepared. Runtime registered locally; Codex configuration was not changed. Run npm run doctor and npm run smoke.\n',
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Setup failed'}\n`,
  );
  process.exitCode = 1;
}
