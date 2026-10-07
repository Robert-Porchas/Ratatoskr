#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BrowserPlanSchema } from './protocol.js';
import { InvalidPlanError } from './errors.js';
import {
  InspectionCategorySchema,
  type InspectionCategory,
} from './inspection.js';
import { createRatatoskrApplication } from './application.js';
import { VERSION } from './version.js';
import { normalizeWirePlan } from './mcp/wire-plan.js';

const app = createRatatoskrApplication();

async function main(args: string[]): Promise<void> {
  const [command, first, second, third, fourth] = args;
  if (command === '--version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === 'derive-workflow' && first) {
    if (second && (second !== '--base-url' || !third))
      throw new Error('Usage: derive-workflow <test.ts> [--base-url <url>]');
    const { deriveWorkflows } = await import('./derive-workflow.js');
    const workflows = deriveWorkflows(
      await readFile(resolve(first), 'utf8'),
      first,
      third,
    );
    process.stdout.write(`${JSON.stringify({ workflows })}\n`);
    if (!workflows.length || workflows.some((workflow) => !workflow.ready))
      process.exitCode = 1;
    return;
  }
  if (command === 'run' && first) {
    const input: unknown = JSON.parse(await readFile(resolve(first), 'utf8'));
    const parsed = BrowserPlanSchema.safeParse(
      input && typeof input === 'object' && 'url' in input
        ? normalizeWirePlan(input)
        : input,
    );
    if (!parsed.success)
      throw new InvalidPlanError(
        parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      );
    const plan = parsed.data;
    const result = await app.run(plan);
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
    const inspected = await app.inspect(first, { include });
    process.stdout.write(`${JSON.stringify(inspected, null, 2)}\n`);
    return;
  }
  if (command === 'artifact' && first && second) {
    const artifact =
      third === '--out' && fourth
        ? await app.artifacts.copyTo(first, second, resolve(fourth))
        : await app.artifacts.get(first, second);
    process.stdout.write(
      `${JSON.stringify({ ...artifact, ...(artifact.sensitive ? { path: undefined } : {}), ...(third === '--out' && fourth ? { copiedTo: resolve(fourth) } : {}) }, null, 2)}\n`,
    );
    return;
  }
  throw new Error(
    'Usage: run <plan.json> | derive-workflow <test.ts> [--base-url <url>] | inspect <runId> [categories] | artifact <runId> <artifactId> [--out <path>]',
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 2;
});
