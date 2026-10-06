import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createRatatoskrApplication } from '../application.js';
import {
  applicationValidatedSchema,
  normalizeWirePlan,
  wirePlanJsonSchema,
  invalidPlanResult,
  InvalidWirePlan,
} from './wire-plan.js';
import { InspectionCategorySchema } from '../inspection.js';
import { ArtifactNotFoundError } from '../errors.js';
import { pathToFileURL } from 'node:url';
import { VERSION } from '../version.js';

const runId = z.string().regex(/^run_[a-f0-9]{32}$/);
const artifactId = z.string().regex(/^artifact_[a-f0-9]{32}$/);
const runOutput = z
  .object({
    success: z.boolean(),
    runId,
    values: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
const inspectionInput = z.strictObject({
  runId,
  include: z.array(InspectionCategorySchema).min(1).max(9).default(['summary']),
  offset: z.number().int().min(0).max(10_000).optional(),
});
const inspectionOutput = z.object({
  runId,
  sections: z.record(z.string(), z.unknown()),
});
const artifactOutput = z.object({
  id: artifactId,
  runId,
  type: z.enum(['screenshot', 'trace', 'download', 'browser_storage_state']),
  mimeType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
  fileName: z.string().optional(),
  localPath: z.string().optional(),
  inline: z.boolean(),
  sensitive: z.boolean().optional(),
  inlineRetrievalAllowed: z.boolean().optional(),
});

function toolError(error: unknown) {
  const message =
    error instanceof ArtifactNotFoundError
      ? error.message
      : error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? 'Run not found'
        : 'Ratatoskr request failed; check local diagnostics';
  process.stderr.write(
    `${JSON.stringify({ level: 'error', name: error instanceof Error ? error.name : 'UnknownError' })}\n`,
  );
  return {
    content: [{ type: 'text' as const, text: message.slice(0, 300) }],
    isError: true,
  };
}

export function createMcpServer(): McpServer {
  const allowedRefs = new Set(
    (process.env.RATATOSKR_ALLOWED_VALUE_REFS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)),
  );
  const app = createRatatoskrApplication(process.env, allowedRefs);
  const server = new McpServer({ name: 'ratatoskr', version: VERSION });
  let active = false;

  server.registerTool(
    'run_browser_workflow',
    {
      description:
        'Batch known app steps in one call. Locator: label/text/testId/css/role+name. fill: valueRef; has: text contains; url: URL contains; extractText/Attribute: save (+attribute). Saved values return on failure too. No JS/shell. Inspect only if evidence is insufficient.',
      inputSchema: applicationValidatedSchema(wirePlanJsonSchema),
      outputSchema: runOutput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input, context) => {
      let plan;
      try {
        plan = normalizeWirePlan(input);
      } catch (error) {
        return invalidPlanResult(error);
      }
      if (active)
        return {
          content: [
            { type: 'text', text: 'Another browser workflow is active' },
          ],
          isError: true,
        };
      active = true;
      try {
        const canonical = await app.run(plan, context.mcpReq.signal);
        const { outputs, ...rest } = canonical;
        const result = { ...rest, ...(outputs ? { values: outputs } : {}) };
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
        'Read selected run evidence only if the workflow result is insufficient. Defaults: 10 items/category; use offset for more.',
      inputSchema: applicationValidatedSchema(z.toJSONSchema(inspectionInput)),
      outputSchema: inspectionOutput,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const parsed = inspectionInput.safeParse(input);
      if (!parsed.success)
        return invalidPlanResult(
          new InvalidWirePlan(
            'arguments',
            'Use runId, supported include categories and optional offset',
          ),
        );
      const { runId: id, ...options } = parsed.data;
      try {
        const result = await app.inspect(id, options);
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
        'Retrieve one registered artifact only when needed. Images are explicit; large binaries return metadata, not bytes.',
      inputSchema: applicationValidatedSchema(
        z.toJSONSchema(z.strictObject({ artifactId })),
      ),
      outputSchema: artifactOutput,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const parsed = z.strictObject({ artifactId }).safeParse(input);
      if (!parsed.success)
        return invalidPlanResult(
          new InvalidWirePlan('artifactId', 'Use a registered artifact ID'),
        );
      const id = parsed.data.artifactId;
      try {
        const artifact = await app.artifacts.find(id);
        const metadata = {
          id: artifact.id,
          runId: artifact.runId,
          type: artifact.type,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          createdAt: artifact.createdAt,
          ...(artifact.fileName ? { fileName: artifact.fileName } : {}),
        };
        if (artifact.sensitive || artifact.inlineRetrievalAllowed === false)
          return {
            content: [
              {
                type: 'text',
                text: 'Sensitive local authentication state; inline retrieval prohibited.',
              },
            ],
            structuredContent: {
              ...metadata,
              sensitive: true,
              inlineRetrievalAllowed: false,
              inline: false,
            },
          };
        if (artifact.type === 'screenshot' && artifact.sizeBytes <= 5_000_000) {
          const bytes = await app.artifacts.read(id, 5_000_000);
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
          const bytes = await app.artifacts.read(id, 16_000);
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

export function startMcpServer(): void {
  const handle = serveStdio(createMcpServer);
  process.on('SIGINT', () => {
    void handle.close();
  });
  process.on('SIGTERM', () => {
    void handle.close();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  startMcpServer();
