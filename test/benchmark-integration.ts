import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFile } from 'node:fs/promises';
import { startProfileFixture } from '../benchmarks/browser-evidence/fixture.js';
import { runReplay } from '../benchmarks/browser-evidence/agent.js';
import { startDirectBrowser } from '../benchmarks/browser-evidence/direct-browser.js';
import { startRatatoskrSession } from '../benchmarks/browser-evidence/ratatoskr-session.js';

const root = await mkdtemp(join(tmpdir(), 'ratatoskr-benchmark-'));
const fixture = await startProfileFixture();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(fixture.url);
  assert.equal(await page.getByLabel('Name').inputValue(), 'Jane Developer');
  assert.equal(
    await page.getByLabel('Email').inputValue(),
    'jane@example.test',
  );
  const consoleMessages: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  await page.getByLabel('Name').fill('Ratatoskr Test');
  const [response] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/profile')),
    page.getByRole('button', { name: 'Save' }).click(),
  ]);
  assert.equal(response.status(), 500);
  assert.equal(
    ((await response.json()) as { error: string }).error,
    'INTERNAL_ERROR',
  );
  await page
    .getByRole('status')
    .filter({ hasText: 'Unable to save profile.' })
    .waitFor();
  assert(consoleMessages.includes('Failed to save profile: INTERNAL_ERROR'));
  assert.equal(
    await page.getByTestId('persisted-name').innerText(),
    'Jane Developer',
  );
  await page.reload();
  assert.equal(await page.getByLabel('Name').inputValue(), 'Jane Developer');
  await page.close();
  for (const mode of ['baseline', 'ratatoskr'] as const) {
    const directory = join(root, mode);
    await mkdir(directory);
    const session =
      mode === 'baseline'
        ? await startDirectBrowser(
            fixture.url,
            directory,
            new AbortController().signal,
          )
        : await startRatatoskrSession(
            fixture.url,
            directory,
            new AbortController().signal,
          );
    const replies: string[] = [];
    try {
      const report = await runReplay(mode, fixture.url, async (name, args) => {
        const reply = await session.call(name, args);
        assert(!reply.images?.length);
        replies.push(reply.text);
        return reply;
      });
      assert.equal(report.persisted, false);
      assert.equal(report.status, 500);
      assert.equal(report.errorCode, 'INTERNAL_ERROR');
      const metrics = await session.metrics();
      assert(metrics.rawEvidenceBytes > 0);
      if (mode === 'ratatoskr') {
        assert.equal(replies.length, 1);
        assert(Buffer.byteLength(replies[0] ?? '') < 2200);
        assert(!(replies[0] ?? '').includes('iVBOR'));
        assert(!(replies[0] ?? '').includes('UEsDB'));
        assert(metrics.artifactBytes > 0);
      }
    } finally {
      await session.close();
    }
  }
  for (const mode of ['baseline', 'ratatoskr'] as const) {
    const directory = join(root, `codex-${mode}`);
    await mkdir(directory);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        new URL(
          '../benchmarks/browser-evidence/codex-tools.js',
          import.meta.url,
        ).pathname,
      ],
      env: {
        BENCHMARK_MODE: mode,
        BENCHMARK_DIRECTORY: directory,
        BENCHMARK_FIXTURE_URL: fixture.url,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'benchmark-wrapper-test', version: '1' });
    try {
      await client.connect(transport);
      const report = await runReplay(mode, fixture.url, async (name, args) => {
        const result = await client.callTool({ name, arguments: args });
        const block = result.content.find((block) => block.type === 'text');
        assert(block?.type === 'text');
        return {
          text: JSON.stringify(
            result.structuredContent ?? JSON.parse(block.text),
          ),
        };
      });
      assert.equal(report.status, 500);
      assert.equal(report.errorCode, 'INTERNAL_ERROR');
      const metrics = JSON.parse(
        await readFile(join(directory, 'codex-browser-metrics.json'), 'utf8'),
      ) as { returnedEvidenceBytes: number; toolInteractions: number };
      assert(metrics.returnedEvidenceBytes > 0);
      assert.equal(metrics.toolInteractions, mode === 'baseline' ? 6 : 1);
    } finally {
      await client.close();
      await transport.close();
    }
  }
  process.stdout.write(
    'Profile fixture, direct replay, and real Ratatoskr MCP replay passed.\n',
  );
} finally {
  await browser.close();
  await fixture.close();
  await rm(root, { recursive: true, force: true });
}
