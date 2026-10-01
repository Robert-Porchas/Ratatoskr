import { resolve } from 'node:path';
import { PlaywrightBrowserAdapter } from './playwright-adapter.js';
import { executePlan } from './executor.js';
import { inspectRun, type InspectionOptions } from './inspection.js';
import type { BrowserPlan } from './protocol.js';
import { FilesystemArtifactStore, FilesystemRunStore } from './storage.js';
import { DirectoryUploadResolver } from './uploads.js';
import { EnvironmentValueResolver } from './values.js';

/** Shared application boundary used by CLI and MCP; no transport concerns. */
export function createBridgeApplication(
  environment: NodeJS.ProcessEnv = process.env,
  allowedValueRefs?: ReadonlySet<string>,
) {
  const root = resolve(
    environment.BROWSER_BRIDGE_DATA_DIR ?? '.browser-bridge',
  );
  const runs = new FilesystemRunStore(root);
  const artifacts = new FilesystemArtifactStore(root);
  return {
    runs,
    artifacts,
    run: (plan: BrowserPlan, signal?: AbortSignal) =>
      executePlan(plan, {
        browser: new PlaywrightBrowserAdapter(),
        runs,
        artifacts,
        values: new EnvironmentValueResolver(environment, allowedValueRefs),
        uploads: new DirectoryUploadResolver(
          environment.BROWSER_BRIDGE_UPLOAD_DIR,
        ),
        ...(signal ? { signal } : {}),
      }),
    inspect: (runId: string, options: InspectionOptions) =>
      inspectRun(runId, options, runs),
  };
}
