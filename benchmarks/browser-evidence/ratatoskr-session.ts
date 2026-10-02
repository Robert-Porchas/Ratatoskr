import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { normalizeWirePlan } from '../../src/mcp/wire-plan.js';
import { FilesystemRunStore } from '../../src/storage.js';
import type { BrowserSession } from './tools.js';

export async function startRatatoskrSession(
  url: string,
  directory: string,
  signal: AbortSignal,
): Promise<BrowserSession> {
  const root = join(directory, 'ratatoskr');
  const runs = new FilesystemRunStore(root);
  const runIds = new Set<string>();
  const stderr: string[] = [];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../../src/mcp/server.js', import.meta.url).pathname],
    env: {
      RATATOSKR_DATA_DIR: root,
      RATATOSKR_ALLOWED_VALUE_REFS: process.env.BENCHMARK_VALUES
        ? Object.keys(
            JSON.parse(process.env.BENCHMARK_VALUES) as Record<string, string>,
          ).join(',')
        : 'BENCHMARK_NAME',
      BENCHMARK_NAME: 'Ratatoskr Test',
      ...(process.env.BENCHMARK_VALUES
        ? z
            .record(z.string(), z.string())
            .parse(JSON.parse(process.env.BENCHMARK_VALUES))
        : {}),
    },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) =>
    stderr.push(chunk.toString()),
  );
  const client = new Client({
    name: 'ratatoskr-browser-benchmark',
    version: '1.0.0',
  });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close();
    throw error;
  }
  const discovered = await client.listTools();
  return {
    tools: discovered.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema,
    })),
    async call(name, args) {
      signal.throwIfAborted();
      if (name === 'run_browser_workflow') {
        const plan = normalizeWirePlan(args);
        if (
          plan.startUrl !== url ||
          plan.steps.some(
            (step) => step.action === 'navigate' && step.url !== url,
          )
        )
          throw new Error('Only the exact fixture URL is permitted');
      }
      const result = await client.callTool(
        { name, arguments: args },
        { signal, timeout: 60_000 },
      );
      const structured = z
        .record(z.string(), z.unknown())
        .safeParse(result.structuredContent);
      const runId = structured.success ? structured.data.runId : undefined;
      if (name === 'run_browser_workflow' && typeof runId === 'string')
        runIds.add(runId);
      const images = result.content.flatMap((block) =>
        block.type === 'image'
          ? [{ data: block.data, mimeType: block.mimeType }]
          : [],
      );
      // Native Codex receives the original MCP result. The API driver gets one canonical value.
      return {
        text: JSON.stringify(
          result.structuredContent ??
            result.content.filter((block) => block.type !== 'image'),
        ),
        mcpResult: result,
        ...(images.length ? { images } : {}),
      };
    },
    async metrics() {
      let rawEvidenceBytes = 0,
        artifactBytes = 0,
        browserInteractions = 0;
      for (const id of runIds) {
        const run = await runs.load(id);
        rawEvidenceBytes += run.record.metrics.rawEvidenceBytes;
        artifactBytes += run.record.artifacts.reduce(
          (sum, artifact) => sum + artifact.sizeBytes,
          0,
        );
        // Count all attempted primitive steps, including assertions and initial navigation; production metrics omit assertions.
        browserInteractions += 1 + run.steps.length;
      }
      return { rawEvidenceBytes, artifactBytes, browserInteractions };
    },
    async close() {
      try {
        await client.close();
      } finally {
        await transport.close();
        await writeFile(join(directory, 'mcp-stderr.log'), stderr.join(''));
      }
    },
  };
}
