import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { FilesystemRunStore } from '../src/storage.js';
import { createFixtureServer } from './fixture/server.js';

const root = await mkdtemp(join(tmpdir(), 'bridge-mcp-'));
const fixture = createFixtureServer();
let client: Client | undefined;
let transport: StdioClientTransport | undefined;
try {
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const address = fixture.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const stderr: string[] = [];
  const transportErrors: Error[] = [];
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../src/mcp/server.js', import.meta.url).pathname],
    cwd: process.cwd(),
    env: {
      BROWSER_BRIDGE_DATA_DIR: root,
      BROWSER_BRIDGE_ALLOWED_VALUE_REFS: 'TEST_EMAIL,TEST_PASSWORD',
      TEST_EMAIL: 'demo@example.test',
      TEST_PASSWORD: 'secret-mcp-password',
    },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) =>
    stderr.push(chunk.toString()),
  );
  transport.onerror = (error) => transportErrors.push(error);
  client = new Client({ name: 'browser-bridge-integration', version: '0.1.0' });
  await client.connect(transport);
  const discovered = await client.listTools();
  assert.deepEqual(discovered.tools.map((tool) => tool.name).sort(), [
    'get_browser_artifact',
    'inspect_browser_run',
    'run_browser_workflow',
  ]);
  for (const tool of discovered.tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert(tool.inputSchema.properties);
  }
  const fields = [
    {
      action: 'fill',
      target: { kind: 'label', label: 'Email' },
      valueRef: 'TEST_EMAIL',
    },
    {
      action: 'fill',
      target: { kind: 'label', label: 'Password' },
      valueRef: 'TEST_PASSWORD',
    },
    {
      action: 'click',
      target: { kind: 'role', role: 'button', name: 'Sign in' },
    },
  ];
  const successPlan = {
    startUrl: `${base}/login`,
    steps: [...fields, { action: 'assert_url', contains: '/dashboard' }],
  };
  const failurePlan = {
    startUrl: `${base}/login-failure`,
    steps: [
      ...fields,
      { action: 'assert_url', contains: '/dashboard', timeoutMs: 400 },
    ],
  };
  const successCall = await client.callTool({
    name: 'run_browser_workflow',
    arguments: successPlan,
  });
  assert(!successCall.isError);
  const success = successCall.structuredContent as {
    success: boolean;
    runId: string;
  };
  assert.equal(success.success, true);
  assert.deepEqual(Object.keys(success).sort(), ['runId', 'success']);
  const blockedRefCall = await client.callTool({
    name: 'run_browser_workflow',
    arguments: {
      startUrl: `${base}/login`,
      steps: [
        {
          action: 'fill',
          target: { kind: 'label', label: 'Password' },
          valueRef: 'PATH',
        },
      ],
    },
  });
  const blockedRef = blockedRefCall.structuredContent as {
    success: boolean;
    reason: string;
  };
  assert.equal(blockedRef.success, false);
  assert.match(blockedRef.reason, /Value reference PATH is not set/);
  const failureCall = await client.callTool({
    name: 'run_browser_workflow',
    arguments: failurePlan,
  });
  assert(!failureCall.isError);
  const failure = failureCall.structuredContent as {
    success: boolean;
    runId: string;
    failedStep: number;
    reason: string;
    relevantErrors: Array<{ type: string; status?: number }>;
    artifacts: { screenshot: string; trace?: string };
  };
  assert.equal(failure.success, false);
  assert.equal(failure.failedStep, 3);
  assert(
    failure.relevantErrors.some(
      (error) => error.type === 'http' && error.status === 500,
    ),
  );
  assert(failure.artifacts.screenshot);
  assert(!JSON.stringify(failureCall).includes('base64'));
  assert(!JSON.stringify(failureCall).includes('iVBOR'));
  assert(!JSON.stringify(failureCall).includes('secret-mcp-password'));
  const inspectCall = await client.callTool({
    name: 'inspect_browser_run',
    arguments: {
      runId: failure.runId,
      include: ['failed_requests', 'metrics', 'artifacts'],
      maxItemsPerCategory: 1,
    },
  });
  assert(!inspectCall.isError);
  const inspection = inspectCall.structuredContent as {
    sections: {
      failed_requests: {
        items: unknown[];
        returnedCount: number;
        availableCount: number;
        truncated: boolean;
      };
      metrics: { rawEvidenceBytes: number };
      artifacts: { items: unknown[] };
    };
  };
  assert.equal(inspection.sections.failed_requests.returnedCount, 1);
  assert(inspection.sections.failed_requests.availableCount >= 1);
  const screenshotCall = await client.callTool({
    name: 'get_browser_artifact',
    arguments: { artifactId: failure.artifacts.screenshot },
  });
  assert(!screenshotCall.isError);
  assert(
    screenshotCall.content.some(
      (block) =>
        block.type === 'image' &&
        block.mimeType === 'image/png' &&
        block.data.length > 100,
    ),
  );
  const screenshot = screenshotCall.structuredContent as {
    id: string;
    inline: boolean;
    sizeBytes: number;
  };
  assert.equal(screenshot.id, failure.artifacts.screenshot);
  assert.equal(screenshot.inline, true);
  const traceCall = await client.callTool({
    name: 'run_browser_workflow',
    arguments: {
      startUrl: `${base}/missing`,
      steps: [
        {
          action: 'click',
          target: { kind: 'role', role: 'button', name: 'Absent' },
          timeoutMs: 200,
        },
      ],
    },
  });
  const traceFailure = traceCall.structuredContent as {
    success: boolean;
    artifacts: { trace: string };
  };
  assert.equal(traceFailure.success, false);
  assert(traceFailure.artifacts.trace);
  assert(!JSON.stringify(traceCall).includes('UEsDB'));
  const traceArtifactCall = await client.callTool({
    name: 'get_browser_artifact',
    arguments: { artifactId: traceFailure.artifacts.trace },
  });
  const traceArtifact = traceArtifactCall.structuredContent as {
    type: string;
    inline: boolean;
    localPath: string;
  };
  assert.equal(traceArtifact.type, 'trace');
  assert.equal(traceArtifact.inline, false);
  assert(traceArtifact.localPath.endsWith('.zip'));
  assert(!traceArtifactCall.content.some((block) => block.type === 'image'));
  const runStore = new FilesystemRunStore(root);
  const persisted = await runStore.load(failure.runId);
  assert(!JSON.stringify(persisted).includes('secret-mcp-password'));
  const sizes = {
    planBytes: Buffer.byteLength(JSON.stringify(failurePlan)),
    rawEvidenceBytes: inspection.sections.metrics.rawEvidenceBytes,
    compactResultBytes: Buffer.byteLength(JSON.stringify(failure)),
    mcpResultBytes: Buffer.byteLength(JSON.stringify(failureCall)),
    inspectionBytes: Buffer.byteLength(JSON.stringify(inspectCall)),
    artifactMetadataBytes: Buffer.byteLength(JSON.stringify(screenshot)),
    toolDefinitionsBytes: Buffer.byteLength(JSON.stringify(discovered.tools)),
  };
  // Budgets allow modest schema/evidence evolution while guarding against accidental dumps.
  assert(Buffer.byteLength(JSON.stringify(success)) < 350);
  assert(sizes.compactResultBytes < 1500);
  assert(sizes.mcpResultBytes < 2200);
  assert(sizes.inspectionBytes < 3500);
  assert(sizes.artifactMetadataBytes < 500);
  assert(sizes.toolDefinitionsBytes < 16_000);
  assert.equal(
    transportErrors.length,
    0,
    transportErrors.map(String).join('; '),
  );
  assert(!stderr.join('').includes('secret-mcp-password'));
  process.stdout.write(
    `${JSON.stringify({ tools: discovered.tools.map((tool) => tool.name), success, failure, inspection: inspectCall.structuredContent, screenshot: { id: screenshot.id, mimeType: 'image/png', sizeBytes: screenshot.sizeBytes, deliveredAsImage: true }, trace: { id: traceFailure.artifacts.trace, inline: traceArtifact.inline }, sizes })}\n`,
  );
} finally {
  await client?.close();
  await transport?.close();
  fixture.close();
  await rm(root, { recursive: true, force: true });
}
