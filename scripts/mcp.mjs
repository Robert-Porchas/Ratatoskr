// This launcher is copied into Codex's plugin cache; the prepared runtime is not.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { assertNode, installationHome, registeredRoot } from './runtime.mjs';

try {
  assertNode();
  const root = await registeredRoot();
  process.env.RATATOSKR_DATA_DIR ??= join(installationHome(), 'data');
  const { startMcpServer } = await import(
    pathToFileURL(join(root, 'dist/src/mcp/server.js')).href
  );
  startMcpServer();
} catch {
  process.stderr.write(
    'Ratatoskr cannot start. Run npm ci && npm run setup in your retained clone; then npm run doctor.\n',
  );
  process.exitCode = 1;
}
