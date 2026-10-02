import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { startDirectBrowser } from './direct-browser.js';
import { startRatatoskrSession } from './ratatoskr-session.js';
import { bytes, type ToolReply } from './tools.js';
import { measureSchemas } from './codex-observations.js';

/** Benchmark-only transport: expose the same replies already measured by the API/replay drivers. */
const mode = z
  .enum(['baseline', 'ratatoskr'])
  .parse(process.env.BENCHMARK_MODE);
const url = z.url().parse(process.env.BENCHMARK_FIXTURE_URL);
const directory = z.string().min(1).parse(process.env.BENCHMARK_DIRECTORY);
const controller = new AbortController();
const session =
  mode === 'baseline'
    ? await startDirectBrowser(url, directory, controller.signal)
    : await startRatatoskrSession(url, directory, controller.signal);
let interactions = 0,
  returnedEvidenceBytes = 0;
const persistMetrics = async () =>
  writeFile(
    join(directory, 'codex-browser-metrics.json'),
    JSON.stringify({
      ...(await session.metrics()),
      toolInteractions: interactions,
      returnedEvidenceBytes,
      toolDefinitionsBytes: bytes(session.tools),
      schemaByTool: measureSchemas(session.tools),
    }),
  );
await persistMetrics();
const server = new McpServer({ name: 'benchmark-browser', version: '1.0.0' });
for (const tool of session.tools) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema),
    },
    async (args) => {
      const start = Date.now();
      let reply: ToolReply;
      if (interactions >= 24)
        throw new Error('Maximum browser tool calls exceeded');
      try {
        reply = await session.call(tool.name, args);
      } catch (error) {
        reply = {
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Tool failed',
          }),
        };
      }
      interactions++;
      returnedEvidenceBytes +=
        Buffer.byteLength(reply.text) +
        (reply.images ?? []).reduce(
          (sum, image) => sum + Buffer.byteLength(image.data),
          0,
        );
      await appendFile(
        join(directory, 'interactions.jsonl'),
        JSON.stringify({
          index: interactions,
          name: tool.name,
          arguments: args,
          reply,
          durationMs: Date.now() - start,
        }) + '\n',
      );
      await persistMetrics();
      return (
        reply.mcpResult ?? {
          content: [
            { type: 'text' as const, text: reply.text },
            ...(reply.images ?? []).map((image) => ({
              type: 'image' as const,
              data: image.data,
              mimeType: image.mimeType,
            })),
          ],
        }
      );
    },
  );
}
const handle = serveStdio(() => server);
let stopping: Promise<void> | undefined;
const stop = () =>
  (stopping ??= (async () => {
    controller.abort();
    await handle.close();
    await session.close();
  })());
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
process.stdin.on('end', () => {
  void stop();
});
