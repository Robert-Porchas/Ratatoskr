import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { BrowserSession } from './tools.js';

/** Official Playwright MCP, with all fixture-relevant core tools (including bulk fill).
 * JS execution, file access and installation are excluded in this local experiment. */
export async function startPlaywrightSession(
  url: string,
  directory: string,
  signal: AbortSignal,
): Promise<BrowserSession> {
  const cli = join(
    dirname(
      createRequire(import.meta.url).resolve('@playwright/mcp/package.json'),
    ),
    'cli.js',
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      cli,
      '--headless',
      '--isolated',
      '--executable-path',
      chromium.executablePath(),
      '--viewport-size',
      '1280x720',
      '--allowed-origins',
      new URL(url).origin,
      '--no-webmcp',
      '--output-dir',
      directory,
      ...(process.env.BENCHMARK_STORAGE_BASELINE === '1'
        ? ['--caps', 'storage']
        : []),
    ],
    cwd: directory,
    stderr: 'pipe',
  });
  const diagnostics: string[] = [];
  transport.stderr?.on('data', (chunk: Buffer) =>
    diagnostics.push(chunk.toString()),
  );
  const client = new Client({
    name: 'standard-browser-benchmark',
    version: '1',
  });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close();
    throw error;
  }
  const allow = new Set([
    'browser_navigate',
    'browser_click',
    'browser_type',
    'browser_fill_form',
    'browser_snapshot',
    'browser_wait_for',
    'browser_network_requests',
    'browser_console_messages',
    'browser_press_key',
    'browser_select_option',
    'browser_hover',
    'browser_take_screenshot',
    'browser_tabs',
    'browser_close',
    'browser_handle_dialog',
    'browser_resize',
    'browser_drag',
  ]);
  if (process.env.BENCHMARK_STORAGE_BASELINE === '1') {
    for (const name of [
      'browser_network_request',
      'browser_cookie_list',
      'browser_localstorage_list',
      'browser_sessionstorage_list',
    ])
      allow.add(name);
  }
  const tools = (await client.listTools()).tools.filter((tool) =>
    allow.has(tool.name),
  );
  const evidence: unknown[] = [];
  let operations = 0;
  return {
    tools: tools.map((tool) => ({
      ...tool,
      description: tool.description ?? '',
    })),
    async call(name, args) {
      signal.throwIfAborted();
      if (!allow.has(name))
        throw new Error('Tool is outside the benchmark scope');
      if (name === 'browser_navigate' && args.url !== url) {
        const destination = new URL(String(args.url));
        if (
          process.env.BENCHMARK_WORKFLOW_SCOPE !== '1' ||
          destination.origin !== new URL(url).origin ||
          destination.username ||
          destination.password
        )
          throw new Error('Only fixture navigation is permitted');
      }
      if (args.filename !== undefined)
        throw new Error('Benchmark calls may not specify filesystem paths');
      operations++;
      const result = await client.callTool(
        { name, arguments: args },
        { signal, timeout: 60_000 },
      );
      evidence.push({ name, args, result });
      return {
        text: JSON.stringify(
          result.structuredContent ??
            result.content.filter((block) => block.type !== 'image'),
        ),
        mcpResult: result,
        images: result.content.flatMap((block) =>
          block.type === 'image'
            ? [{ data: block.data, mimeType: block.mimeType }]
            : [],
        ),
      };
    },
    async metrics() {
      await writeFile(
        join(directory, 'playwright-observations.json'),
        JSON.stringify(evidence, null, 2),
      );
      return {
        rawEvidenceBytes: Buffer.byteLength(JSON.stringify(evidence)),
        artifactBytes: 0,
        browserInteractions: operations,
      };
    },
    async close() {
      await client.close();
      await transport.close();
      await writeFile(
        join(directory, 'playwright-stderr.log'),
        diagnostics.join(''),
      );
    },
  };
}
