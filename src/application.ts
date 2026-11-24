import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { compareRuns, type ComparisonOptions } from './compare-runs.js';
import {
  exportWorkflow,
  type WorkflowExportOptions,
} from './export-workflow.js';
import {
  loadApplicationDiagnostics,
  diagnoseEvidence,
  resolveSourceLocation,
} from './diagnostics.js';
import { PlaywrightBrowserAdapter } from './playwright-adapter.js';
import { executePlan } from './executor.js';
import { inspectRun, type InspectionOptions } from './inspection.js';
import type { BrowserPlan } from './protocol.js';
import { FilesystemArtifactStore, FilesystemRunStore } from './storage.js';
import { DirectoryUploadResolver } from './uploads.js';
import { EnvironmentValueResolver } from './values.js';

/** Shared application boundary used by CLI and MCP; no transport concerns. */
export function createRatatoskrApplication(
  environment: NodeJS.ProcessEnv = process.env,
  allowedValueRefs?: ReadonlySet<string>,
) {
  const root = resolve(environment.RATATOSKR_DATA_DIR ?? '.ratatoskr');
  const runs = new FilesystemRunStore(root);
  const artifacts = new FilesystemArtifactStore(root);
  const diagnostics = async () => {
    if (!environment.RATATOSKR_APPLICATION_CONFIG)
      throw new Error(
        'Set RATATOSKR_APPLICATION_CONFIG to enable application diagnostics',
      );
    return loadApplicationDiagnostics(environment.RATATOSKR_APPLICATION_CONFIG);
  };
  return {
    runs,
    artifacts,
    run: async (plan: BrowserPlan, signal?: AbortSignal) => {
      const config = environment.RATATOSKR_APPLICATION_CONFIG
        ? await diagnostics()
        : undefined;
      return executePlan(plan, {
        browser: new PlaywrightBrowserAdapter({
          correlationHeaders: config?.correlationHeaders ?? [],
        }),
        runs,
        artifacts,
        values: new EnvironmentValueResolver(environment, allowedValueRefs),
        uploads: new DirectoryUploadResolver(environment.RATATOSKR_UPLOAD_DIR),
        sessionDiagnostics: environment.RATATOSKR_SESSION_DIAGNOSTICS !== 'off',
        captureAuthState: environment.RATATOSKR_CAPTURE_AUTH_STATE === '1',
        ...(signal ? { signal } : {}),
      });
    },
    compare: (
      baselineId: string,
      candidateId: string,
      options: ComparisonOptions = {},
    ) => compareRuns(baselineId, candidateId, runs, options),
    diagnose: async (runId: string) =>
      diagnoseEvidence((await runs.load(runId)).evidence, await diagnostics()),
    source: async (url: string, line: number, column: number) =>
      resolveSourceLocation(await diagnostics(), url, line, column),
    export: async (plan: BrowserPlan, options: WorkflowExportOptions = {}) => {
      const result = exportWorkflow(plan, options);
      const { source, ...metadata } = result;
      if (!source) return metadata;
      const runId = `run_${randomUUID().replaceAll('-', '')}`;
      const reserved = await artifacts.reservePath(runId, 'download');
      try {
        await writeFile(reserved.path, source, { flag: 'wx', mode: 0o600 });
        const artifact = await artifacts.register(
          runId,
          'download',
          reserved.id,
          reserved.path,
          { fileName: 'workflow.spec.ts', mimeType: 'text/plain' },
        );
        return {
          ...metadata,
          artifact: { id: artifact.id, runId, sizeBytes: artifact.sizeBytes },
        };
      } catch (error) {
        await artifacts.discard(runId, 'download', reserved.id);
        throw error;
      }
    },
    inspect: (runId: string, options: InspectionOptions) =>
      inspectRun(runId, options, runs),
  };
}
