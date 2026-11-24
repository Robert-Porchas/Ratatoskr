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
import { ComparisonOptionsSchema } from '../compare-runs.js';
import { HttpUrlSchema } from '../protocol.js';

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
  include: z
    .array(InspectionCategorySchema)
    .min(1)
    .max(10)
    .default(['summary']),
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

  const comparisonInput = z.strictObject({
    baselineRunId: runId,
    candidateRunId: runId,
    ...ComparisonOptionsSchema.shape,
  });
  server.registerTool(
    'compare_browser_runs',
    {
      description:
        'Compare before/after evidence. Reports observed changes and completeness limits; success alone is not proof of a fix.',
      inputSchema: applicationValidatedSchema(z.toJSONSchema(comparisonInput)),
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const parsed = comparisonInput.safeParse(input);
      if (!parsed.success)
        return invalidPlanResult(
          new InvalidWirePlan(
            'arguments',
            'Use baselineRunId, candidateRunId, optional include and maxDifferences (1–50)',
          ),
        );
      try {
        const { baselineRunId, candidateRunId, ...options } = parsed.data;
        const result = await app.compare(
          baselineRunId,
          candidateRunId,
          options,
        );
        return {
          content: [{ type: 'text', text: `Comparison: ${result.status}` }],
          structuredContent: { ...result },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
  const exportInput = z.strictObject({
    runId,
    testName: z.string().min(1).max(200).optional(),
  });
  server.registerTool(
    'export_browser_workflow',
    {
      description:
        'Strictly export a persisted workflow to a Playwright Test artifact. Unsupported semantics prevent export. Environment setup is explicit; no assertions are invented.',
      inputSchema: applicationValidatedSchema(z.toJSONSchema(exportInput)),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const parsed = exportInput.safeParse(input);
      if (!parsed.success)
        return invalidPlanResult(
          new InvalidWirePlan('arguments', 'Use runId and optional testName'),
        );
      try {
        const run = await app.runs.load(parsed.data.runId);
        if (JSON.stringify(run.plan).includes('[REDACTED]'))
          return invalidPlanResult(
            new InvalidWirePlan(
              'runId',
              'Workflow contains redacted data; export the reviewed original definition through CLI',
            ),
          );
        const result = await app.export(
          run.plan,
          parsed.data.testName ? { testName: parsed.data.testName } : {},
        );
        return {
          content: [
            {
              type: 'text',
              text: result.ready
                ? 'Workflow exported; retrieve the artifact only if needed'
                : 'Unsupported workflow semantics; inspect unsupported operations',
            },
          ],
          structuredContent: result,
          ...(!result.ready ? { isError: true } : {}),
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
  const diagnosticInput = z.strictObject({
    runId,
    sourceFrame: z
      .strictObject({
        url: HttpUrlSchema.max(2048),
        line: z.number().int().positive().max(10_000_000),
        column: z.number().int().positive().max(10_000_000),
      })
      .optional(),
  });
  server.registerTool(
    'diagnose_browser_run',
    {
      description:
        'Read explicitly configured local route/request diagnostics. Optional generated source frame uses a configured local map. Set RATATOSKR_APPLICATION_CONFIG; source pointers do not prove cause.',
      inputSchema: applicationValidatedSchema(z.toJSONSchema(diagnosticInput)),
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const parsed = diagnosticInput.safeParse(input);
      if (!parsed.success)
        return invalidPlanResult(
          new InvalidWirePlan(
            'arguments',
            'Use runId and optional sourceFrame {url,line,column} (one-indexed)',
          ),
        );
      try {
        const result = await app.diagnose(parsed.data.runId);
        const frame = parsed.data.sourceFrame;
        const mapping = frame
          ? await app.source(frame.url, frame.line, frame.column)
          : undefined;
        return {
          content: [
            {
              type: 'text',
              text: 'Explicit application diagnostics; backend logs unavailable',
            },
          ],
          structuredContent: { ...result, ...(mapping ? { mapping } : {}) },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'run_browser_workflow',
    {
      description:
        'Batch a complete app workflow. Locator: label/text/testId/css/role+name. fill: valueRef or value with ${savedName}; has: text contains; url: URL contains; wait: visible. extractText/Attribute: save. discover: bounded read-only candidates (query/roles/maxResults) on current page, once/run. if: visible/url/exists/equals + then/else; not negates. retry: total attempts 1–3; reloadOnce: wait/extraction + retry:2. No JS/loops. Stop on success; inspect only missing failure evidence.',
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
