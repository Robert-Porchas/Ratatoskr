import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { startWorkflowFixture } from './fixture/workflow.js';

const root = await mkdtemp(join(tmpdir(), 'ratatoskr-benchmark-budget-'));
const fixture = await startWorkflowFixture('variables');
const client = new Client({ name: 'budget-test', version: '1' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    fileURLToPath(
      new URL('../benchmarks/browser-evidence/codex-tools.js', import.meta.url),
    ),
  ],
  env: {
    BENCHMARK_MODE: 'ratatoskr',
    BENCHMARK_DIRECTORY: root,
    BENCHMARK_FIXTURE_URL: fixture.url,
    BENCHMARK_MAX_TOOL_CALLS: '25',
  },
  stderr: 'pipe',
});
try {
  await client.connect(transport);
  const result = await client.callTool({
    name: 'run_browser_workflow',
    arguments: {
      url: fixture.url,
      steps: [{ do: 'visible', testId: 'dashboard' }],
    },
  });
  const { runId } = z
    .object({ success: z.literal(true), runId: z.string() })
    .parse(result.structuredContent);
  for (let index = 0; index < 24; index++) {
    const inspected = await client.callTool({
      name: 'inspect_browser_run',
      arguments: { runId, include: ['summary'] },
    });
    assert(
      !inspected.isError,
      `Configured proxy budget must permit call ${index + 2}: ${JSON.stringify(inspected)}`,
    );
  }
  const rejected = await client.callTool({
    name: 'inspect_browser_run',
    arguments: { runId, include: ['summary'] },
  });
  assert(rejected.isError, 'Proxy must stop after the configured cap');
  const metrics = z
    .object({ toolInteractions: z.literal(25), maxToolCalls: z.literal(25) })
    .parse(
      JSON.parse(
        await readFile(join(root, 'codex-browser-metrics.json'), 'utf8'),
      ),
    );
  assert.equal(metrics.maxToolCalls, 25);
  process.stdout.write(
    'Actual benchmark MCP proxy honors configured call budget above 24 and rejects overflow.\n',
  );
} finally {
  await client.close();
  await transport.close();
  await fixture.close();
  await rm(root, { recursive: true, force: true });
}
