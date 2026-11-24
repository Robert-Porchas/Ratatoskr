import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { PlaywrightBrowserAdapter } from './playwright-adapter.js';
import { loadApplicationDiagnostics } from './diagnostics.js';
import { VERSION } from './version.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail?: string;
  optional?: boolean;
  state?: 'pass' | 'warning' | 'failure' | 'not-checked';
}

/** No installs, configuration mutations, environment values, or application navigation. */
export async function doctor(root: string): Promise<DoctorCheck[]> {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const checks: DoctorCheck[] = [
    {
      name: `Node ${process.versions.node}`,
      ok: major! >= 24 || (major === 22 && minor! >= 12),
    },
  ];
  for (const [name, path] of [
    [`Ratatoskr ${VERSION} build`, 'dist/src/cli.js'],
    ['MCP entry point', 'dist/src/mcp/server.js'],
  ] as const) {
    try {
      await access(join(root, path));
      checks.push({ name, ok: true });
    } catch {
      checks.push({ name, ok: false, detail: 'run npm run build' });
    }
  }
  const data = resolve(process.env.RATATOSKR_DATA_DIR ?? '.ratatoskr');
  try {
    let existing = data;
    let found = false;
    for (let depth = 0; depth < 20; depth++) {
      try {
        if (!(await stat(existing)).isDirectory())
          throw new Error('Not directory');
        found = true;
        break;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
          dirname(existing) === existing
        )
          throw error;
        existing = dirname(existing);
      }
    }
    if (!found) throw new Error('No accessible parent');
    await access(existing, constants.W_OK | constants.X_OK);
    checks.push({
      name: 'Data directory writable',
      ok: true,
      detail:
        existing === data
          ? 'directory accessible; no files written'
          : 'existing parent accessible; directory will be created on execution',
    });
  } catch {
    checks.push({
      name: 'Data directory writable',
      ok: false,
      detail: 'set RATATOSKR_DATA_DIR to a writable directory',
    });
  }
  if (process.env.RATATOSKR_APPLICATION_CONFIG) {
    try {
      await loadApplicationDiagnostics(
        process.env.RATATOSKR_APPLICATION_CONFIG,
      );
      checks.push({ name: 'Application diagnostics configuration', ok: true });
    } catch {
      checks.push({
        name: 'Application diagnostics configuration',
        ok: false,
        detail:
          'check bounded JSON, workspaceRoot and documented route/map schema',
      });
    }
  } else
    checks.push({
      name: 'Application diagnostics configuration',
      ok: false,
      optional: true,
      state: 'not-checked',
      detail: 'not configured; ordinary browser workflows remain available',
    });
  const browser = new PlaywrightBrowserAdapter();
  try {
    await browser.start(() => undefined, false);
    checks.push({ name: 'Chromium launch', ok: true });
  } catch {
    checks.push({
      name: 'Chromium launch',
      ok: false,
      detail:
        'npx playwright install chromium (Linux may also need --with-deps)',
    });
  } finally {
    await browser.stop().catch(() => undefined);
  }
  const refs = (process.env.RATATOSKR_ALLOWED_VALUE_REFS ?? '')
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean);
  const valid =
    refs.length <= 20 &&
    refs.every((ref) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(ref));
  const missing = valid ? refs.filter((ref) => !process.env[ref]).length : 0;
  checks.push({
    name: 'Configured value references',
    ok: valid && !missing,
    detail: !valid
      ? 'use at most20 valid environment names'
      : missing
        ? `${missing} configured names are undefined; values not displayed`
        : `${refs.length} defined; values not displayed`,
  });
  const codex = spawnSync('codex', ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 4096,
    shell: process.platform === 'win32',
  });
  checks.push({
    name: 'Codex CLI',
    ok: codex.status === 0,
    optional: true,
    detail:
      codex.status === 0
        ? 'available'
        : 'not found; standalone CLI still works',
  });
  checks.push({
    name: 'MCP stdio handshake',
    ok: false,
    optional: true,
    state: 'not-checked',
    detail:
      'run npm run smoke for a bounded real handshake and fixture workflow',
  });
  return checks.map((check) => ({
    ...check,
    state:
      check.state ??
      (check.ok ? 'pass' : check.optional ? 'warning' : 'failure'),
  }));
}
