import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BrowserPlanSchema } from './protocol.js';
import { PlaywrightBrowserAdapter } from './playwright-adapter.js';
import { executePlan } from './executor.js';
import { FilesystemArtifactStore, FilesystemRunStore } from './storage.js';
import { EnvironmentValueResolver } from './values.js';
import { InvalidPlanError } from './errors.js';
import {
  inspectRun,
  InspectionCategorySchema,
  type InspectionCategory,
} from './inspection.js';

const dataDirectory = resolve(
  process.env.BROWSER_BRIDGE_DATA_DIR ?? '.browser-bridge',
);
const runs = new FilesystemRunStore(dataDirectory);
const artifacts = new FilesystemArtifactStore(dataDirectory);

async function main(args: string[]): Promise<void> {
  const [command, first, second, third, fourth] = args;
  if (command === 'run' && first) {
    const parsed = BrowserPlanSchema.safeParse(
      JSON.parse(await readFile(resolve(first), 'utf8')),
    );
    if (!parsed.success)
      throw new InvalidPlanError(
        parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      );
    const plan = parsed.data;
    const result = await executePlan(plan, {
      browser: new PlaywrightBrowserAdapter(),
      runs,
      artifacts,
      values: new EnvironmentValueResolver(),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.success) process.exitCode = 1;
    return;
  }
  if (command === 'inspect' && first) {
    const aliases: Record<string, InspectionCategory> = {
      console: 'console_errors',
      network: 'failed_requests',
    };
    const requested = second
      ? second.split(',').map((value) => aliases[value] ?? value)
      : ['summary', 'metrics', 'artifacts'];
    const include = requested.includes('all')
      ? InspectionCategorySchema.options
      : requested.map((value) => InspectionCategorySchema.parse(value));
    const inspected = await inspectRun(first, { include }, runs);
    process.stdout.write(`${JSON.stringify(inspected, null, 2)}\n`);
    return;
  }
  if (command === 'artifact' && first && second) {
    const artifact =
      third === '--out' && fourth
        ? await artifacts.copyTo(first, second, resolve(fourth))
        : await artifacts.get(first, second);
    process.stdout.write(
      `${JSON.stringify({ ...artifact, ...(third === '--out' && fourth ? { copiedTo: resolve(fourth) } : {}) }, null, 2)}\n`,
    );
    return;
  }
  throw new Error(
    'Usage: run <plan.json> | inspect <runId> [steps,console,network,navigation,page_errors,all] | artifact <runId> <artifactId> [--out <path>]',
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 2;
});
