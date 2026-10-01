import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createBridgeApplication } from '../application.js';
import { BrowserPlanSchema } from '../protocol.js';
import {
  InspectionOptionsSchema,
  InspectionCategorySchema,
} from '../inspection.js';
import { ArtifactNotFoundError } from '../errors.js';

const runId = z.string().regex(/^run_[a-f0-9]{32}$/);
const artifactId = z.string().regex(/^artifact_[a-f0-9]{32}$/);
const relevantError = z.union([
  z.object({
    type: z.literal('http'),
    method: z.string(),
    path: z.string(),
    status: z.number(),
  }),
  z.object({
    type: z.literal('request_failed'),
    method: z.string(),
    path: z.string(),
    error: z.string(),
  }),
  z.object({
    type: z.enum(['console', 'page_error', 'dialog', 'popup']),
    message: z.string(),
  }),
]);
const runOutput = z.union([
  z.object({
    success: z.literal(true),
    runId,
    outputs: z.record(z.string(), z.string()).optional(),
    downloads: z.array(artifactId).optional(),
  }),
  z.object({
    success: z.literal(false),
    runId,
    failedStep: z.number(),
    action: z.string(),
    reason: z.string(),
    actualUrl: z.string().optional(),
    relevantErrors: z.array(relevantError),
    artifacts: z
      .object({
        screenshot: artifactId.optional(),
        trace: artifactId.optional(),
      })
      .optional(),
  }),
]);
const inspectionInput = InspectionOptionsSchema.extend({ runId });
const inspectionOutput = z.object({
  runId,
  sections: z.partialRecord(InspectionCategorySchema, z.unknown()),
});
const artifactOutput = z.object({
  id: artifactId,
  runId,
  type: z.enum(['screenshot', 'trace', 'download']),
  mimeType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
  fileName: z.string().optional(),
  localPath: z.string().optional(),
  inline: z.boolean(),
});

function toolError(error: unknown) {
  const message =
    error instanceof ArtifactNotFoundError
      ? error.message
      : error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? 'Run not found'
        : 'Browser bridge request failed; check local diagnostics';
  process.stderr.write(
    `${JSON.stringify({ level: 'error', name: error instanceof Error ? error.name : 'UnknownError' })}\n`,
  );
  return {
    content: [{ type: 'text' as const, text: message.slice(0, 300) }],
    isError: true,
  };
}

export function createMcpServer(): McpServer {
  const bridge = createBridgeApplication();
  const server = new McpServer({ name: 'browser-bridge', version: '0.1.0' });
  let active = false;

  server.registerTool(
    'run_browser_workflow',
    {
      description:
        'Batch deterministic browser steps for E2E validation and compact failure evidence. Codex must provide a structured plan; no natural-language planning, JavaScript, shell, or filesystem access.',
      inputSchema: BrowserPlanSchema,
      outputSchema: runOutput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (plan, context) => {
      if (active)
        return {
          content: [
            { type: 'text', text: 'Another browser workflow is active' },
          ],
          isError: true,
        };
      active = true;
      try {
        const result = await bridge.run(plan, context.mcpReq.signal);
        return {
          content: [
            {
              type: 'text',
              text: result.success
                ? `Workflow passed: ${result.runId}`
                : `Workflow failed at step ${result.failedStep}: ${result.reason}`,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      } finally {
        active = false;
      }
    },
  );

  server.registerTool(
    'inspect_browser_run',
    {
      description:
        'Read bounded selected evidence from a completed run. Use only when the compact workflow result is insufficient.',
      inputSchema: inspectionInput,
      outputSchema: inspectionOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ runId: id, ...options }) => {
      try {
        const result = await bridge.inspect(id, options);
        return {
          content: [
            {
              type: 'text',
              text: `Inspection for ${id}: ${Object.keys(result.sections).join(', ')}`,
            },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'get_browser_artifact',
    {
      description:
        'Retrieve one registered artifact by ID. Use only when that screenshot, text file, or trace metadata is necessary for diagnosis.',
      inputSchema: z.strictObject({ artifactId }),
      outputSchema: artifactOutput,
      annotations: { readOnlyHint: true },
    },
    async ({ artifactId: id }) => {
      try {
        const artifact = await bridge.artifacts.find(id);
        const metadata = {
          id: artifact.id,
          runId: artifact.runId,
          type: artifact.type,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          createdAt: artifact.createdAt,
          ...(artifact.fileName ? { fileName: artifact.fileName } : {}),
        };
        if (artifact.type === 'screenshot' && artifact.sizeBytes <= 5_000_000) {
          const bytes = await bridge.artifacts.read(id, 5_000_000);
          return {
            content: [
              {
                type: 'image',
                data: bytes.toString('base64'),
                mimeType: artifact.mimeType,
              },
              {
                type: 'text',
                text: `Screenshot ${id} (${artifact.sizeBytes} bytes)`,
              },
            ],
            structuredContent: { ...metadata, inline: true },
          };
        }
        if (
          artifact.mimeType.startsWith('text/') &&
          artifact.sizeBytes <= 16_000
        ) {
          const bytes = await bridge.artifacts.read(id, 16_000);
          return {
            content: [{ type: 'text', text: bytes.toString('utf8') }],
            structuredContent: { ...metadata, inline: true },
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Artifact ${id}: ${artifact.mimeType}, ${artifact.sizeBytes} bytes; local file ${artifact.path}`,
            },
          ],
          structuredContent: {
            ...metadata,
            localPath: artifact.path,
            inline: false,
          },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const handle = serveStdio(createMcpServer);
  process.on('SIGINT', () => {
    void handle.close();
  });
  process.on('SIGTERM', () => {
    void handle.close();
  });
}
