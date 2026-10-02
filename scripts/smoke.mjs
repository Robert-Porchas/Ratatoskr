import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { assertNode, projectRoot } from './runtime.mjs';

assertNode();
const data = await mkdtemp(join(tmpdir(), 'ratatoskr-smoke-'));
const fixture = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(
    '<h1>Ratatoskr smoke</h1><button onclick="document.querySelector(\'p\').textContent=\'Ready\'">Check</button><p role="status">Waiting</p>',
  );
});
const client = new Client({ name: 'ratatoskr-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    join(process.env.RATATOSKR_PLUGIN_ROOT ?? projectRoot, 'scripts/mcp.mjs'),
  ],
  env: { ...process.env, RATATOSKR_DATA_DIR: data },
  stderr: 'pipe',
});
let diagnostics = '';
transport.stderr?.on('data', (chunk) => {
  diagnostics += chunk.toString();
});
try {
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const address = fixture.address();
  assert(address && typeof address !== 'string');
  await client.connect(transport);
  const discovery = await client.listTools();
  assert.deepEqual(discovery.tools.map((tool) => tool.name).sort(), [
    'get_browser_artifact',
    'inspect_browser_run',
    'run_browser_workflow',
  ]);
  const result = await client.callTool({
    name: 'run_browser_workflow',
    arguments: {
      url: `http://127.0.0.1:${address.port}`,
      steps: [
        { do: 'visible', role: 'heading', name: 'Ratatoskr smoke' },
        { do: 'click', role: 'button', name: 'Check' },
        { do: 'has', role: 'status', contains: 'Ready' },
      ],
    },
  });
  assert.equal(result.structuredContent?.success, true);
  assert(!result.isError);
  assert(Buffer.byteLength(JSON.stringify(result)) < 500);
  process.stdout.write(
    `${JSON.stringify({ tools: discovery.tools.map((tool) => tool.name), result: result.structuredContent })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `Smoke failed: ${error instanceof Error ? error.message : 'unknown error'}\n${diagnostics.slice(0, 500)}`,
  );
  process.exitCode = 1;
} finally {
  await client.close();
  await transport.close();
  fixture.closeAllConnections();
  await new Promise((resolve) => fixture.close(resolve));
  await rm(data, { recursive: true, force: true });
}
