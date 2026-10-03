import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import { chromium } from 'playwright';
import { projectRoot } from './runtime.mjs';
import {
  startSettingsFixture,
  settingsTask,
} from '../dist/benchmarks/browser-evidence/settings-fixture.js';
import { codexAccounting } from '../dist/benchmarks/browser-evidence/usage.js';
import { measureCodexTools } from '../dist/benchmarks/browser-evidence/codex-observations.js';
import { ReportSchema } from '../dist/benchmarks/browser-evidence/metrics.js';

// Called by the clean-install test with an isolated, authenticated Codex home.
assert(
  process.env.RATATOSKR_INSTALL_TEST_ROOT && process.env.CODEX_HOME,
  'Use npm run test:install -- --codex',
);
const root = process.env.RATATOSKR_INSTALL_TEST_ROOT;
const codexRelative = relative(root, process.env.CODEX_HOME);
assert(
  codexRelative &&
    !codexRelative.startsWith('..') &&
    !isAbsolute(codexRelative),
  'Codex home must be inside this disposable test tree',
);
const version = JSON.parse(
  await readFile(join(projectRoot, 'package.json'), 'utf8'),
).version;
const cachedConfig = join(
  process.env.CODEX_HOME,
  'plugins/cache/ratatoskr-local/ratatoskr',
  version,
  '.mcp.json',
);
const declared = JSON.parse(await readFile(cachedConfig, 'utf8'));
// Host policy cannot widen a plugin's declared approval requirement in this Codex
// version. Auto-approve one tool ONLY in the disposable fixture-test installation.
declared.mcpServers.ratatoskr.tools = {
  run_browser_workflow: { approval_mode: 'approve' },
};
await writeFile(cachedConfig, JSON.stringify(declared));
const model = process.env.BENCHMARK_MODEL || 'gpt-6.1-sol';
const reasoning = process.env.BENCHMARK_CODEX_REASONING_EFFORT || 'medium';
const schemaPath = join(root, 'diagnosis-schema.json');
await writeFile(schemaPath, JSON.stringify(z.toJSONSchema(ReportSchema)));
const control = join(root, 'control-codex');
await mkdir(control, { recursive: true });
await copyFile(
  join(process.env.CODEX_HOME, 'auth.json'),
  join(control, 'auth.json'),
);
const records = [];

for (const [mode, outcome] of [
  ['control', 'http_failure'],
  ['plugin', 'http_failure'],
  ['plugin', 'success'],
  ['direct', 'http_failure'],
]) {
  const fixture = await startSettingsFixture({ size: 'medium', outcome });
  const task = settingsTask({ size: 'medium', outcome });
  const workspace = await mkdtemp(join(root, `${mode}-${outcome}-`));
  const environment = {
    ...process.env,
    ...task.values,
    CODEX_HOME: mode === 'plugin' ? process.env.CODEX_HOME : control,
  };
  delete environment.CODEX_THREAD_ID;
  delete environment.CODEX_SESSION_ID;
  const instructions = `You are testing a local application. Profile page: ${fixture.url}. Perform the task using the available browser tools. Use condition-based assertions; workflow completion alone does not prove persistence. Inspect only evidence needed for diagnosis. Do not run setup commands. Finish with the structured diagnosis requested by the output schema, supported by browser evidence. ${task.sourceContext}`;
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--cd',
    workspace,
    '--model',
    model,
    '--output-schema',
    schemaPath,
    '-c',
    `developer_instructions=${JSON.stringify(instructions)}`,
    '-c',
    `model_reasoning_effort=${JSON.stringify(reasoning)}`,
    '-c',
    'project_doc_max_bytes=0',
    '-c',
    'web_search="disabled"',
  ];
  if (mode === 'plugin')
    args.push(
      '-c',
      'plugins."ratatoskr@ratatoskr-local".mcp_servers.ratatoskr.default_tools_approval_mode="approve"',
    );
  else if (mode === 'control') {
    const mcp = `{ratatoskr={command=${JSON.stringify(process.execPath)},args=${JSON.stringify([join(projectRoot, 'scripts/mcp.mjs')])},env_vars=${JSON.stringify(['RATATOSKR_HOME', 'PLAYWRIGHT_BROWSERS_PATH', ...Object.keys(task.values)])},env={RATATOSKR_ALLOWED_VALUE_REFS=${JSON.stringify(Object.keys(task.values).join(','))}},startup_timeout_sec=20,tool_timeout_sec=210,default_tools_approval_mode="approve"}}`;
    args.push('-c', `mcp_servers=${mcp}`);
  } else {
    const allowed = [
      'browser_navigate',
      'browser_click',
      'browser_type',
      'browser_fill_form',
      'browser_snapshot',
      'browser_wait_for',
      'browser_network_requests',
      'browser_console_messages',
      'browser_press_key',
      'browser_select_option',
      'browser_hover',
      'browser_take_screenshot',
      'browser_tabs',
      'browser_close',
      'browser_handle_dialog',
      'browser_resize',
      'browser_drag',
    ];
    const commandArgs = [
      join(projectRoot, 'node_modules/@playwright/mcp/cli.js'),
      '--headless',
      '--isolated',
      '--executable-path',
      chromium.executablePath(),
      '--viewport-size',
      '1280x720',
      '--allowed-origins',
      new URL(fixture.url).origin,
      '--no-webmcp',
      '--output-dir',
      workspace,
    ];
    const mcp = `{browser={command=${JSON.stringify(process.execPath)},args=${JSON.stringify(commandArgs)},env_vars=["PLAYWRIGHT_BROWSERS_PATH"],enabled_tools=${JSON.stringify(allowed)},startup_timeout_sec=20,tool_timeout_sec=60,default_tools_approval_mode="approve"}}`;
    args.push('-c', `mcp_servers=${mcp}`);
  }
  args.push('-');
  const child = spawn('codex', args, {
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const events = [];
  let diagnostics = '';
  child.stderr.on('data', (chunk) => {
    diagnostics += chunk.toString();
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    events.push(JSON.parse(line));
  });
  const terminate = () => {
    if (child.pid && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* exited */
      }
    } else child.kill();
  };
  const timer = setTimeout(terminate, 180000);
  child.stdin.end(task.prompt);
  try {
    const exit = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    await writeFile(
      join(workspace, 'events.jsonl'),
      events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    );
    assert.equal(exit, 0, `Codex task failed: ${diagnostics.slice(-500)}`);
    const accounting = codexAccounting(events);
    assert(
      accounting.tokenAuthoritative,
      'Authoritative task usage unavailable',
    );
    const tools = measureCodexTools(events);
    if (mode !== 'direct') {
      assert.equal(tools.invalidToolCalls, 0);
      assert.equal(
        tools.interactions.length,
        1,
        'Expected one browser workflow without inspection',
      );
      assert.equal(tools.interactions[0].name, 'run_browser_workflow');
    }
    const resultText = tools.interactions
      .map((interaction) => interaction.reply.text)
      .join('\n');
    const agentMessages = events.filter(
      (event) =>
        event.type === 'item.completed' && event.item?.type === 'agent_message',
    );
    const report = ReportSchema.parse(
      JSON.parse(agentMessages.at(-1).item.text),
    );
    const submission = fixture.requests.find(
      (request) => request.method === 'POST' && request.path === '/api/profile',
    );
    assert(
      submission &&
        fixture.fields.every(
          (field) => JSON.parse(submission.body)[field.id] === field.desired,
        ),
      'Form not submitted correctly',
    );
    if (outcome === 'http_failure') {
      assert.equal(report.persisted, false);
      assert.equal(report.method, 'POST');
      assert.equal(report.path, '/api/profile');
      assert.equal(report.status, 500);
      assert.equal(report.errorCode, 'INTERNAL_ERROR');
      assert(
        resultText.includes('INTERNAL_ERROR') && resultText.includes('500'),
      );
    } else {
      assert.equal(report.persisted, true);
      assert(
        fixture.fields.every(
          (field) => fixture.stored()[field.id] === field.desired,
        ),
      );
      assert(
        fixture.requests.filter(
          (request) => request.method === 'GET' && request.path === '/profile',
        ).length >= 2,
      );
    }
    const record = {
      mode,
      outcome,
      model,
      reasoning,
      codexVersion: execFileSync('codex', ['--version'], {
        encoding: 'utf8',
      }).trim(),
      accounting,
      toolCalls: tools.interactions.length,
      invalidCalls: tools.invalidToolCalls,
      toolArgumentBytes: tools.toolArgumentBytes,
      toolResultBytes: tools.toolResultBytes,
      skillRead: events.some(
        (event) =>
          event.item?.type === 'command_execution' &&
          event.item.command.includes('SKILL.md'),
      ),
      correct: true,
      report,
    };
    records.push(record);
    process.stdout.write(JSON.stringify(record) + '\n');
  } finally {
    clearTimeout(timer);
    terminate();
    lines.close();
    await fixture.close();
  }
}
await writeFile(
  join(root, 'codex-install-results.json'),
  JSON.stringify(records, null, 2),
);
