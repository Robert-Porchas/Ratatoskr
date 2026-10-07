import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  startWorkflowFixture,
  workflowPlan,
  type WorkflowScenario,
} from './fixture/workflow.js';
import { FilesystemRunStore } from '../src/storage.js';
import { deriveWorkflows } from '../src/derive-workflow.js';

const root = await mkdtemp(join(tmpdir(), 'ratatoskr-workflows-'));
const client = new Client({ name: 'workflow-tests', version: '1' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/mcp/server.js', import.meta.url))],
  env: {
    RATATOSKR_DATA_DIR: root,
    RATATOSKR_ALLOWED_VALUE_REFS:
      'BENCHMARK_NAME,BENCHMARK_FIELD_1,BENCHMARK_FIELD_2',
    BENCHMARK_NAME: 'Ratatoskr Test',
    BENCHMARK_FIELD_1: 'fixture@example.test',
    BENCHMARK_FIELD_2: 'workflow-secret-password',
  },
  stderr: 'pipe',
});
try {
  await client.connect(transport);
  for (const scenario of [
    'variables',
    'login-required',
    'login-existing',
    'transient',
    'server-failure',
    'generated',
    'complex',
  ] as WorkflowScenario[]) {
    const fixture = await startWorkflowFixture(scenario);
    try {
      const generated =
        scenario === 'generated'
          ? deriveWorkflows(
              await readFile('examples/project.spec.ts', 'utf8'),
              'examples/project.spec.ts',
              fixture.base,
            )[0]
          : undefined;
      if (generated) assert(generated.ready);
      const result = await client.callTool(
        {
          name: 'run_browser_workflow',
          arguments: generated?.plan ?? workflowPlan(scenario, fixture.base),
        },
        { timeout: 30_000 },
      );
      const content = z
        .record(z.string(), z.unknown())
        .parse(result.structuredContent);
      assert.equal(
        content.success,
        scenario !== 'server-failure',
        JSON.stringify(result),
      );
      assert.equal(
        fixture.loginCount(),
        ['login-required', 'complex'].includes(scenario) ? 1 : 0,
      );
      if (scenario === 'variables' || scenario === 'complex') {
        assert.deepEqual(content.values, { projectId: 'P-1' });
        assert.equal(fixture.projects.size, 1);
      }
      if (scenario === 'complex')
        assert.equal(fixture.projects.get('P-1')?.description, 'Project P-1');
      if (scenario === 'server-failure')
        assert.equal(
          fixture.requests.filter((request) => request.method === 'POST')
            .length,
          1,
        );
      const stored = await new FilesystemRunStore(root).load(
        String(content.runId),
      );
      assert(!JSON.stringify(stored).includes('workflow-secret-password'));
      if (scenario === 'transient' || scenario === 'complex') {
        assert(
          stored.steps.some(
            (step) =>
              step.attempts === 2 &&
              step.trace?.some((event) => event.event === 'recovery'),
          ),
        );
        assert(!('attempts' in content));
      }
      process.stdout.write(
        JSON.stringify({
          scenario,
          success: content.success,
          calls: 1,
          durationMs: stored.record.metrics.durationMs,
        }) + '\n',
      );
    } finally {
      await fixture.close();
    }
  }
} finally {
  await client.close();
  await transport.close();
  await rm(root, { recursive: true, force: true });
}
