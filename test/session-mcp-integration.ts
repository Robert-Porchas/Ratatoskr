import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { FilesystemArtifactStore } from '../src/storage.js';
import {
  createSessionFixture,
  FAKE_SESSION_SECRET,
  FAKE_STORAGE_SECRET,
} from './fixture/session.js';

const root = await mkdtemp(join(tmpdir(), 'ratatoskr-session-mcp-'));
const fixture = createSessionFixture();
const client = new Client({ name: 'session-security-test', version: '1' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/mcp/server.js', import.meta.url))],
  env: { RATATOSKR_DATA_DIR: root, RATATOSKR_CAPTURE_AUTH_STATE: '1' },
  stderr: 'pipe',
});
let diagnostics = '';
const protocolErrors: Error[] = [];
transport.stderr?.on('data', (chunk: Buffer) => {
  diagnostics += chunk.toString();
});
transport.onerror = (error) => protocolErrors.push(error);
try {
  fixture.server.listen(0, '127.0.0.1');
  await once(fixture.server, 'listening');
  const address = fixture.server.address();
  assert(address && typeof address !== 'string');
  await client.connect(transport);
  const discovery = await client.listTools();
  assert.equal(discovery.tools.length, 3);
  assert(Buffer.byteLength(JSON.stringify(discovery.tools)) < 4500);
  const reply = await client.callTool({
    name: 'run_browser_workflow',
    arguments: {
      url: `http://127.0.0.1:${address.port}/auth?scenario=missing&echo=1`,
      steps: [
        { do: 'click', role: 'button', name: 'Sign in' },
        { do: 'has', role: 'status', contains: 'Sign-in accepted' },
        { do: 'click', role: 'button', name: 'Open dashboard' },
        { do: 'has', testId: 'dashboard', contains: 'Dashboard ready' },
      ],
    },
  });
  const result = z
    .record(z.string(), z.unknown())
    .parse(reply.structuredContent);
  assert(!reply.isError && result.success === false);
  const runId = result.runId;
  assert(typeof runId === 'string');
  assert(Buffer.byteLength(JSON.stringify(reply)) < 2200);
  const inspection = await client.callTool({
    name: 'inspect_browser_run',
    arguments: { runId, include: ['session', 'artifacts', 'console_errors'] },
  });
  const store = new FilesystemArtifactStore(root);
  const artifact = await store.save(
    runId,
    'browser_storage_state',
    Buffer.from(
      JSON.stringify({
        cookies: [{ name: 'session', value: FAKE_SESSION_SECRET }],
      }),
    ),
  );
  const protectedReply = await client.callTool({
    name: 'get_browser_artifact',
    arguments: { artifactId: artifact.id },
  });
  assert(!protectedReply.isError);
  const metadata = z
    .record(z.string(), z.unknown())
    .parse(protectedReply.structuredContent);
  assert.equal(metadata.sensitive, true);
  assert.equal(metadata.inlineRetrievalAllowed, false);
  assert.equal(metadata.inline, false);
  assert(!metadata.localPath);
  assert(protectedReply.content.every((block) => block.type === 'text'));
  for (const output of [
    reply,
    inspection,
    protectedReply,
    discovery,
    diagnostics,
  ]) {
    assert(!JSON.stringify(output).includes(FAKE_SESSION_SECRET));
    assert(!JSON.stringify(output).includes(FAKE_STORAGE_SECRET));
  }
  const bad = await client.callTool({
    name: 'get_browser_artifact',
    arguments: { artifactId: '../../secret.storage-state.json' },
  });
  assert(bad.isError && Buffer.byteLength(JSON.stringify(bad)) < 750);
  const session = z
    .record(z.string(), z.unknown())
    .parse(inspection.structuredContent).sections;
  assert(session && typeof session === 'object');
  assert(Buffer.byteLength(JSON.stringify(session)) < 6000);
  assert.equal(protocolErrors.length, 0);
  process.stdout.write(
    `${JSON.stringify({ toolsBytes: Buffer.byteLength(JSON.stringify(discovery.tools)), failure: reply.structuredContent, inspection: inspection.structuredContent, protectedArtifact: protectedReply.structuredContent, secretsRedacted: true })}\n`,
  );
} finally {
  await client.close();
  await transport.close();
  fixture.server.closeAllConnections();
  await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
}
