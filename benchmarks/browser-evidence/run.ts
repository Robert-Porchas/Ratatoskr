import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { z } from 'zod';
import { startProfileFixture } from './fixture.js';
import { startDirectBrowser } from './direct-browser.js';
import { startRatatoskrSession } from './ratatoskr-session.js';
import {
  finishTool,
  observedFailure,
  runModel,
  runReplay,
  type Interaction,
  type ModelTurn,
} from './agent.js';
import {
  cumulativeUsage,
  parseResults,
  summarize,
  type BenchmarkResult,
  type DiagnosisReport,
} from './metrics.js';
import { bytes, type BrowserSession, type ToolReply } from './tools.js';

const requestedMode = z
  .enum(['both', 'baseline', 'ratatoskr'])
  .parse(process.argv[2] ?? 'both');
const driver = z
  .enum(['replay', 'model'])
  .parse(process.env.BENCHMARK_DRIVER ?? 'replay');
const runs = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .parse(process.env.BENCHMARK_RUNS ?? '10');
const model = driver === 'model' ? process.env.BENCHMARK_MODEL : null;
if (driver === 'model' && (!process.env.OPENAI_API_KEY || !model))
  throw new Error('Set OPENAI_API_KEY and BENCHMARK_MODEL for model mode');
const maxTurns = 16,
  maxToolCalls = 24,
  maxOutputTokens = 4096,
  timeoutMs = 120_000;
const prompt = (
  await readFile(
    new URL('../../../benchmarks/browser-evidence/prompt.txt', import.meta.url),
    'utf8',
  )
).trim();
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const dirty = Boolean(
  execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
);
const configuration = {
  driver,
  model: model ?? null,
  maxTurns,
  maxToolCalls,
  maxOutputTokens,
  timeoutMs,
  viewport: { width: 1280, height: 720 },
  prompt,
  benchmarkVersion: '1',
  dirty,
  nodeVersion: process.version,
  platform: `${process.platform}/${process.arch}`,
  lockfileHash: createHash('sha256')
    .update(await readFile('package-lock.json'))
    .digest('hex'),
};
const configurationHash = createHash('sha256')
  .update(JSON.stringify(configuration))
  .digest('hex');
const suiteId = process.env.BENCHMARK_SUITE ?? randomUUID();
if (!/^[a-zA-Z0-9_-]+$/.test(suiteId))
  throw new Error('BENCHMARK_SUITE must be an identifier');
const root = resolve('benchmarks/browser-evidence/results', suiteId);
await mkdir(root, { recursive: true });
const metadataPath = join(root, 'configuration.json');
try {
  const existing = JSON.parse(await readFile(metadataPath, 'utf8')) as {
    configurationHash: string;
    gitCommit: string;
  };
  if (
    existing.configurationHash !== configurationHash ||
    existing.gitCommit !== gitCommit
  )
    throw new Error('Existing suite configuration differs');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  await writeFile(
    metadataPath,
    JSON.stringify({ ...configuration, configurationHash, gitCommit }, null, 2),
    { flag: 'wx' },
  );
}
const probe = await chromium.launch({ headless: true });
const browserVersion = probe.version();
await probe.close();
const results: BenchmarkResult[] = [];
for (let run = 1; run <= runs; run++) {
  // Alternate order to reduce systematic warm-cache/startup bias.
  const modes: Array<'baseline' | 'ratatoskr'> =
    requestedMode === 'both'
      ? run % 2
        ? ['baseline', 'ratatoskr']
        : ['ratatoskr', 'baseline']
      : [requestedMode];
  for (const mode of modes) {
    const directory = join(root, `${mode}-${run}`);
    await mkdir(directory, { recursive: false });
    const fixture = await startProfileFixture();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    const interactions: Interaction[] = [],
      turns: ModelTurn[] = [];
    let session: BrowserSession | undefined,
      report: DiagnosisReport | undefined,
      error: string | undefined;
    let modelCalls = 0,
      returnedEvidenceBytes = 0,
      insertedEvidenceBytes = 0,
      cumulativeContextEvidenceBytes = 0;
    let local = {
      rawEvidenceBytes: 0,
      artifactBytes: 0,
      browserInteractions: 0,
    };
    let toolDefinitionsBytes = 0;
    try {
      session =
        mode === 'baseline'
          ? await startDirectBrowser(fixture.url, directory, controller.signal)
          : await startRatatoskrSession(
              fixture.url,
              directory,
              controller.signal,
            );
      toolDefinitionsBytes = bytes(
        [...session.tools, finishTool].map((tool) => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: false,
        })),
      );
      const call = async (
        name: string,
        args: Record<string, unknown>,
      ): Promise<ToolReply> => {
        const at = Date.now();
        let reply: ToolReply;
        try {
          reply = await session!.call(name, args);
        } catch (failure) {
          reply = {
            text: JSON.stringify({
              error: failure instanceof Error ? failure.message : 'Tool failed',
            }),
          };
        }
        const payloadBytes =
          Buffer.byteLength(reply.text) +
          (reply.images ?? []).reduce(
            (sum, image) => sum + Buffer.byteLength(image.data),
            0,
          );
        returnedEvidenceBytes += payloadBytes;
        const interaction = {
          index: interactions.length + 1,
          name,
          arguments: args,
          reply,
          durationMs: Date.now() - at,
        };
        interactions.push(interaction);
        await appendFile(
          join(directory, 'interactions.jsonl'),
          JSON.stringify(interaction) + '\n',
        );
        return reply;
      };
      if (driver === 'replay')
        report = await runReplay(mode, fixture.url, call);
      else
        report = await runModel({
          model: model!,
          prompt,
          instructions: `You are testing a local application. Profile page: ${fixture.url}. Desired name is available locally as valueRef BENCHMARK_NAME. Use the available browser tools to perform the task and verify persistence, using condition-based waits (step timeout 500 ms for expected persisted text is sufficient). Inspect only evidence needed for diagnosis. Finish by calling report_diagnosis with supported facts; a workflow completing does not by itself prove persistence.`,
          tools: session.tools,
          maxTurns,
          maxToolCalls,
          maxOutputTokens,
          signal: controller.signal,
          call,
          beforeTurn: () => {
            modelCalls++;
            cumulativeContextEvidenceBytes += returnedEvidenceBytes;
            insertedEvidenceBytes = returnedEvidenceBytes;
          },
          recordTurn: async (turn) => {
            turns.push(turn);
            await appendFile(
              join(directory, 'model-turns.jsonl'),
              JSON.stringify(turn) + '\n',
            );
          },
        });
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Benchmark failed';
    } finally {
      clearTimeout(timer);
      if (session) {
        try {
          local = await session.metrics();
        } catch {
          error ??= 'Local evidence metrics unavailable';
        }
        await session.close().catch(() => {
          error ??= 'Browser cleanup failed';
        });
      }
      await fixture.close();
    }
    const observations = interactions.map(
      (interaction) => interaction.reply.text,
    );
    const observed = observedFailure(observations);
    const submitted = fixture.requests.some((request) => {
      if (request.method !== 'POST' || request.path !== '/api/profile')
        return false;
      try {
        return (
          (JSON.parse(request.body) as { name?: string }).name ===
          'Ratatoskr Test'
        );
      } catch {
        return false;
      }
    });
    const criteria = {
      openedCorrectPage: fixture.requests.some(
        (request) => request.method === 'GET' && request.path === '/profile',
      ),
      changedName: submitted,
      attemptedSave: submitted,
      recognizedPersistenceFailure:
        report?.persisted === false && observed.persistenceFailure,
      identifiedHttp500:
        report?.method === 'POST' &&
        report.path === '/api/profile' &&
        report.status === 500 &&
        observed.http?.status === 500,
      identifiedInternalError:
        report?.errorCode === 'INTERNAL_ERROR' &&
        observed.code === 'INTERNAL_ERROR',
      didNotClaimPersistence: report?.persisted === false,
    };
    const usage = cumulativeUsage(turns.map((turn) => turn.usage));
    // A failed/unreported invocation must not silently disappear from cumulative totals.
    const totals =
      turns.length === modelCalls ? usage : cumulativeUsage([null]);
    const result: BenchmarkResult = {
      benchmarkVersion: '1',
      suiteId,
      mode,
      driver,
      run,
      timestamp: new Date(startedAt).toISOString(),
      gitCommit,
      configurationHash,
      model: model ?? null,
      browserVersion,
      success: !error && Object.values(criteria).every(Boolean),
      diagnosisCorrect:
        criteria.recognizedPersistenceFailure &&
        criteria.identifiedHttp500 &&
        criteria.identifiedInternalError &&
        criteria.didNotClaimPersistence,
      criteria,
      modelCalls,
      toolInteractions: interactions.length,
      ...local,
      ...totals,
      tokenSource: totals.totalTokens === null ? 'unavailable' : 'provider',
      modelEvidenceBytes: driver === 'model' ? insertedEvidenceBytes : null,
      returnedEvidenceBytes,
      cumulativeContextEvidenceBytes:
        driver === 'model' ? cumulativeContextEvidenceBytes : null,
      toolDefinitionsBytes,
      durationMs: Date.now() - startedAt,
      ...(error ? { error } : {}),
    };
    await writeFile(
      join(directory, 'fixture-audit.json'),
      JSON.stringify(fixture.requests, null, 2),
    );
    await writeFile(
      join(directory, 'report.json'),
      JSON.stringify({ report: report ?? null, result }, null, 2),
    );
    const log = `# ${mode} run ${run} (${driver})\n\nTask: ${prompt}\n\n${interactions.map((item) => `${item.index}. ${item.name} (${item.durationMs} ms; ${Buffer.byteLength(item.reply.text)} text bytes)\n\n\`\`\`json\n${JSON.stringify(item.arguments)}\n${item.reply.text}\n\`\`\``).join('\n\n')}\n\nDiagnosis: ${JSON.stringify(report ?? null)}\n\nCriteria: ${JSON.stringify(criteria)}\n`;
    await writeFile(join(directory, 'run.md'), log);
    await appendFile(
      join(root, 'results.jsonl'),
      JSON.stringify(result) + '\n',
    );
    results.push(result);
    process.stdout.write(JSON.stringify(result) + '\n');
  }
}
const all = parseResults(await readFile(join(root, 'results.jsonl'), 'utf8'));
if (
  all.some((row) => row.mode === 'baseline') &&
  all.some((row) => row.mode === 'ratatoskr')
) {
  const summary = summarize(all);
  await writeFile(join(root, 'summary.md'), summary);
  process.stdout.write(summary);
}
process.stdout.write(`Results: ${root}\n`);
if (results.some((result) => !result.success)) process.exitCode = 1;
