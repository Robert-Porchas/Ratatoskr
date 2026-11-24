import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { SourceMap, type SourceMapPayload } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { Evidence } from './protocol.js';

const correlationHeader = z.enum([
  'x-request-id',
  'x-correlation-id',
  'traceparent',
]);
const relativePath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value),
    'Expected a relative local path',
  );
const generatedUrl = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      /^https?:$/.test(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  });

export const ApplicationDiagnosticsConfigSchema = z.strictObject({
  workspaceRoot: z.string().min(1).max(4096),
  routes: z
    .array(
      z.strictObject({
        method: z.enum([
          'GET',
          'HEAD',
          'POST',
          'PUT',
          'PATCH',
          'DELETE',
          'OPTIONS',
        ]),
        path: z
          .string()
          .min(1)
          .max(512)
          .regex(/^\/[^?#]*$/),
        source: relativePath,
        symbol: z.string().min(1).max(128).optional(),
      }),
    )
    .max(100)
    .default([]),
  correlationHeaders: z.array(correlationHeader).max(3).default([]),
  sourceMaps: z
    .array(z.strictObject({ generatedUrl, mapPath: relativePath }))
    .max(8)
    .default([]),
});

export interface ApplicationDiagnostics {
  readonly workspaceRoot: string;
  readonly routes: z.output<
    typeof ApplicationDiagnosticsConfigSchema
  >['routes'];
  readonly correlationHeaders: string[];
  readonly sourceMaps: z.output<
    typeof ApplicationDiagnosticsConfigSchema
  >['sourceMaps'];
}

export interface DiagnosticObservation {
  evidenceIndex: number;
  stepIndex: number | null;
  method: string;
  path: string;
  status?: number;
  correlationIds?: Record<string, string>;
  sourceReferences: Array<{
    path: string;
    symbol?: string;
    relationship: 'explicit_route_mapping';
  }>;
  limitations: string[];
}

/** Reads at most limit+1 bytes, including when the file grows after opening. */
async function boundedJson(path: string, limit: number): Promise<unknown> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit)
      throw new Error('Diagnostic file is not a bounded regular JSON file');
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit)
      throw new Error('Diagnostic JSON exceeds size limit');
    return JSON.parse(
      buffer.subarray(0, bytesRead).toString('utf8'),
    ) as unknown;
  } finally {
    await handle.close();
  }
}

function within(root: string, path: string): boolean {
  const difference = relative(root, path);
  return (
    difference !== '' &&
    difference !== '..' &&
    !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

async function localFile(root: string, path: string): Promise<string> {
  const candidate = resolve(root, path);
  if (!within(root, candidate)) throw new Error('Path is outside workspace');
  const canonical = await realpath(candidate);
  if (!within(root, canonical) || !(await stat(canonical)).isFile())
    throw new Error('Path is not a workspace file');
  return canonical;
}

/** Explicit JSON only: never loads executable project configuration. */
export async function loadApplicationDiagnostics(
  configPath: string,
): Promise<ApplicationDiagnostics> {
  const file = await realpath(resolve(configPath));
  const parsed = ApplicationDiagnosticsConfigSchema.safeParse(
    await boundedJson(file, 64 * 1024),
  );
  if (!parsed.success)
    throw new Error('Invalid application diagnostics configuration');
  const workspaceRoot = await realpath(
    resolve(dirname(file), parsed.data.workspaceRoot),
  );
  if (!(await stat(workspaceRoot)).isDirectory())
    throw new Error('Diagnostics workspaceRoot must be a directory');
  return { ...parsed.data, workspaceRoot };
}

function safeCorrelationIds(
  event: Evidence,
  headers: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  if (
    !('correlationIds' in event) ||
    !event.correlationIds ||
    typeof event.correlationIds !== 'object'
  )
    return result;
  for (const header of headers) {
    const value = (event.correlationIds as Record<string, unknown>)[header];
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value))
      continue;
    if (
      header === 'traceparent' &&
      !/^[a-f0-9]{2}-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/.test(value)
    )
      continue;
    result[header] = value;
  }
  return result;
}

/** Explicit mappings are source candidates, never evidence of a backend root cause. */
export async function diagnoseEvidence(
  evidence: readonly Evidence[],
  config: ApplicationDiagnostics,
): Promise<{
  observations: DiagnosticObservation[];
  truncated: boolean;
  limitations: string[];
}> {
  const observations: DiagnosticObservation[] = [];
  let truncated = evidence.length > 5000;
  for (let index = 0; index < Math.min(evidence.length, 5000); index++) {
    const event = evidence[index]!;
    if (
      event.type !== 'request_failed' &&
      !(event.type === 'http' && event.status >= 400)
    )
      continue;
    if (observations.length === 20) {
      truncated = true;
      break;
    }
    const path = event.path.split(/[?#]/, 1)[0]!;
    const observation: DiagnosticObservation = {
      evidenceIndex: index,
      stepIndex: event.stepIndex,
      method: event.method.slice(0, 16),
      path: path.slice(0, 300),
      ...(event.type === 'http' ? { status: event.status } : {}),
      sourceReferences: [],
      limitations: [],
    };
    const ids = safeCorrelationIds(event, config.correlationHeaders);
    if (Object.keys(ids).length) observation.correlationIds = ids;
    for (const route of config.routes
      .filter((route) => route.method === event.method && route.path === path)
      .slice(0, 5)) {
      try {
        const source = await localFile(config.workspaceRoot, route.source);
        observation.sourceReferences.push({
          path: relative(config.workspaceRoot, source).split(sep).join('/'),
          ...(route.symbol ? { symbol: route.symbol } : {}),
          relationship: 'explicit_route_mapping',
        });
      } catch {
        observation.limitations.push(
          'Mapped source is missing or outside the authorized workspace',
        );
      }
    }
    if (!observation.sourceReferences.length)
      observation.limitations.push('No validated explicit source mapping');
    observations.push(observation);
  }
  // Field and item limits are complemented by a serialized response budget.
  while (Buffer.byteLength(JSON.stringify(observations)) > 12000) {
    observations.pop();
    truncated = true;
  }
  return {
    observations,
    truncated,
    limitations: [
      'Backend logs unavailable; explicit route mappings do not establish root cause',
      'Route mappings match method and path; application origin is not verified',
    ],
  };
}

const sourceMapSchema = z.object({
  version: z.literal(3),
  file: z.string().max(2048).optional(),
  sources: z.array(z.string().max(512)).max(10000),
  names: z.array(z.string().max(512)).max(10000).default([]),
  mappings: z.string().max(1024 * 1024),
  sourceRoot: relativePath.or(z.literal('')).optional(),
});

/** Explicit configured local maps only; positions in this API are one-indexed. */
export async function resolveSourceLocation(
  config: ApplicationDiagnostics,
  url: string,
  line: number,
  column: number,
): Promise<{
  generated: { url: string; line: number; column: number };
  sourceReference?: {
    path: string;
    line: number;
    column: number;
    relationship: 'source_map';
  };
  limitations: string[];
}> {
  if (
    !generatedUrl.safeParse(url).success ||
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(column) ||
    line < 1 ||
    column < 1
  )
    throw new Error(
      'Expected a credential-free generated URL and positive integer location',
    );
  const generated = { url, line, column };
  const configured = config.sourceMaps.find((map) => map.generatedUrl === url);
  if (!configured)
    return {
      generated,
      limitations: ['No explicit source map configured for this generated URL'],
    };
  try {
    const mapPath = await localFile(config.workspaceRoot, configured.mapPath);
    const payload = sourceMapSchema.parse(
      await boundedJson(mapPath, 1024 * 1024),
    );
    // sourcesContent is deliberately discarded: source contents are never returned or evaluated.
    const map = new SourceMap({
      ...payload,
      file: payload.file ?? '',
      sourceRoot: payload.sourceRoot ?? '',
      sourcesContent: [],
    } as SourceMapPayload);
    const entry = map.findEntry(line - 1, column - 1);
    if (
      !('originalSource' in entry) ||
      entry.generatedLine !== line - 1 ||
      !Number.isSafeInteger(entry.originalLine) ||
      !Number.isSafeInteger(entry.originalColumn) ||
      entry.originalLine < 0 ||
      entry.originalColumn < 0 ||
      !relativePath.safeParse(entry.originalSource).success
    )
      return {
        generated,
        limitations: ['No supported mapping covers this generated location'],
      };
    const source = await localFile(
      config.workspaceRoot,
      relative(
        config.workspaceRoot,
        resolve(
          dirname(mapPath),
          payload.sourceRoot ?? '',
          entry.originalSource,
        ),
      ),
    );
    return {
      generated,
      sourceReference: {
        path: relative(config.workspaceRoot, source).split(sep).join('/'),
        line: entry.originalLine + 1,
        column: entry.originalColumn + 1,
        relationship: 'source_map',
      },
      limitations: [
        'Source-map content is explicitly configured; freshness is not verified',
      ],
    };
  } catch {
    return {
      generated,
      limitations: [
        'Source map is missing, malformed, unsupported, or references a source outside the authorized workspace',
      ],
    };
  }
}
