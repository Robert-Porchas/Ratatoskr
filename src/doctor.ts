import { access, mkdir, open, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { PlaywrightBrowserAdapter } from './playwright-adapter.js';
import { VERSION } from './version.js';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
  optional?: boolean;
}

/** Installation probes never print environment values or start an application workflow. */
export async function doctor(root: string): Promise<Check[]> {
  const checks: Check[] = [
    {
      name: `Node ${process.versions.node}`,
      ok: Number(process.versions.node.split('.')[0]) >= 22,
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
  const probe = join(data, `.doctor-${randomUUID()}`);
  try {
    await mkdir(data, { recursive: true });
    const handle = await open(probe, 'wx', 0o600);
    await handle.close();
    await unlink(probe);
    checks.push({ name: 'Data directory writable', ok: true, detail: data });
  } catch {
    checks.push({
      name: 'Data directory writable',
      ok: false,
      detail: 'set RATATOSKR_DATA_DIR to a writable directory',
    });
  }
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
  const missing = refs.filter((ref) => !process.env[ref]);
  checks.push({
    name: 'Configured value references',
    ok: !missing.length,
    detail: missing.length
      ? `missing: ${missing.join(', ')}`
      : `${refs.length} defined; values not displayed`,
  });
  const codex = spawnSync('codex', ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    shell: process.platform === 'win32',
  });
  checks.push({
    name: 'Codex CLI',
    ok: codex.status === 0,
    optional: true,
    detail:
      codex.status === 0
        ? codex.stdout.trim().slice(0, 80)
        : 'not found; standalone CLI still works',
  });
  return checks;
}
