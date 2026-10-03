import {
  assertNode,
  installationHome,
  projectRoot,
  registeredRoot,
} from './runtime.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

try {
  assertNode();
  const { doctor } = await import(
    pathToFileURL(join(projectRoot, 'dist/src/doctor.js')).href
  );
  process.env.RATATOSKR_DATA_DIR ??= join(installationHome(), 'data');
  const checks = await doctor(projectRoot);
  try {
    const runtime = await registeredRoot();
    checks.push({
      name: 'Plugin runtime registration',
      ok: runtime === projectRoot,
      detail:
        runtime === projectRoot
          ? 'this clone'
          : 'another clone; run npm run setup here',
    });
  } catch {
    checks.push({
      name: 'Plugin runtime registration',
      ok: false,
      detail: 'run npm run setup',
    });
  }
  for (const check of checks)
    process.stdout.write(
      `${check.ok ? 'OK' : check.optional ? 'NOTE' : 'FAIL'} ${check.name}${check.detail ? `: ${check.detail}` : ''}\n`,
    );
  const ready = checks.every((check) => check.ok || check.optional);
  process.stdout.write(
    ready
      ? 'Ratatoskr is ready.\n'
      : 'Fix the failed checks before using Ratatoskr.\n',
  );
  if (!ready) process.exitCode = 1;
} catch {
  process.stderr.write(
    'Ratatoskr doctor could not load the build. Use Node 22.12+ (22.x) or 24+, npm ci, then npm run setup.\n',
  );
  process.exitCode = 1;
}
