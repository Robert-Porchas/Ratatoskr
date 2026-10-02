import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectRoot } from './runtime.mjs';

const arguments_ = process.argv.slice(2);
assert(
  arguments_.every((argument) => argument === '--codex'),
  'Usage: npm run test:install [-- --codex]',
);
const testRoot = await mkdtemp(join(tmpdir(), 'ratatoskr-clean-install-'));
const clone = join(testRoot, 'clone with spaces');
const environment = {
  ...process.env,
  RATATOSKR_HOME: join(testRoot, 'runtime'),
  CODEX_HOME: join(testRoot, 'codex'),
  PLAYWRIGHT_BROWSERS_PATH: join(testRoot, 'browsers'),
  npm_config_cache: join(testRoot, 'npm-cache'),
};
delete environment.RATATOSKR_DATA_DIR;
delete environment.RATATOSKR_UPLOAD_DIR;
delete environment.RATATOSKR_ALLOWED_VALUE_REFS;
delete environment.TEST_EMAIL;
delete environment.TEST_PASSWORD;
const npm = process.env.npm_execpath;
assert(npm, 'Run through npm run test:install');
function run(command, args, cwd = clone, overrides = {}) {
  process.stdout.write(
    `CHECK ${command === process.execPath ? 'node/npm' : command} ${args.join(' ')}\n`,
  );
  const result = spawnSync(command, args, {
    cwd,
    env: { ...environment, ...overrides },
    stdio: 'inherit',
    timeout: 600000,
  });
  assert(
    !result.error && result.status === 0,
    `Installation command failed: ${command} ${args.join(' ')}`,
  );
}
const runNpm = (args) => run(process.execPath, [npm, ...args]);
try {
  run('git', ['clone', '--no-local', projectRoot, clone], testRoot);
  for (const forbidden of ['node_modules', 'dist', '.env', '.ratatoskr']) {
    let present = false;
    try {
      await access(join(clone, forbidden));
      present = true;
    } catch {
      /* absent */
    }
    assert(!present, `Clean clone inherited ${forbidden}`);
  }
  await mkdir(environment.CODEX_HOME, { recursive: true, mode: 0o700 });
  runNpm(['ci']);
  runNpm(['run', 'setup']);
  run('codex', ['plugin', 'marketplace', 'add', '.']);
  run('codex', ['plugin', 'add', 'ratatoskr@ratatoskr-local']);
  run('codex', ['plugin', 'list', '--json']);
  runNpm(['run', 'doctor']);
  runNpm(['run', 'smoke']);
  run(process.execPath, ['scripts/codex-discovery.mjs']);
  runNpm(['test']);
  runNpm(['run', 'typecheck']);
  runNpm(['run', 'lint']);
  runNpm(['run', 'test:dist']);
  runNpm(['run', 'test:mcp']);
  // Test the actual cached launcher, not just the retained clone's copy.
  const pluginRoot = join(
    environment.CODEX_HOME,
    'plugins/cache/ratatoskr-local/ratatoskr',
    JSON.parse(await readFile(join(clone, 'package.json'), 'utf8')).version,
  );
  run(process.execPath, ['scripts/smoke.mjs'], clone, {
    RATATOSKR_PLUGIN_ROOT: pluginRoot,
  });
  // Verify the documented manual registration separately; don't enable duplicates.
  run('codex', ['plugin', 'remove', 'ratatoskr@ratatoskr-local']);
  run('codex', [
    'mcp',
    'add',
    'ratatoskr',
    '--env',
    `RATATOSKR_HOME=${environment.RATATOSKR_HOME}`,
    '--',
    process.execPath,
    join(clone, 'scripts/mcp.mjs'),
  ]);
  run('codex', ['mcp', 'list']);
  run('codex', ['mcp', 'remove', 'ratatoskr']);
  run('codex', ['plugin', 'add', 'ratatoskr@ratatoskr-local']);
  if (arguments_.includes('--codex')) {
    const refs = [
      'BENCHMARK_NAME',
      'BENCHMARK_FIELD_1',
      'BENCHMARK_FIELD_2',
      'BENCHMARK_FIELD_3',
    ];
    runNpm(['run', 'setup', '--', '--value-refs', refs.join(',')]);
    run('codex', ['plugin', 'remove', 'ratatoskr@ratatoskr-local']);
    run('codex', ['plugin', 'add', 'ratatoskr@ratatoskr-local']);
    const auth = join(
      process.env.CODEX_HOME || join(homedir(), '.codex'),
      'auth.json',
    );
    await copyFile(auth, join(environment.CODEX_HOME, 'auth.json'));
    await chmod(join(environment.CODEX_HOME, 'auth.json'), 0o600);
    run(process.execPath, ['scripts/test-codex.mjs'], clone, {
      RATATOSKR_INSTALL_TEST_ROOT: testRoot,
    });
    process.stdout.write(
      (await readFile(join(testRoot, 'codex-install-results.json'), 'utf8')) +
        '\n',
    );
  }
  process.stdout.write(
    'PASS clean clone, isolated dependencies/browser/config/data, doctor, smoke and Codex discovery.\n',
  );
} finally {
  // Only this mkdtemp-owned test tree is removed, including temporary auth copies.
  await rm(testRoot, { recursive: true, force: true });
}
