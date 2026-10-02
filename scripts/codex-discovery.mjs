import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

// Read-only Codex discovery using its locally generated app-server protocol.
const child = spawn('codex', ['app-server'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map();
let id = 0;
const lines = createInterface({ input: child.stdout });
child.stderr.on('data', () => undefined);
child.on('error', (error) => {
  for (const entry of pending.values()) entry.reject(error);
});
child.on('exit', () => {
  for (const entry of pending.values())
    entry.reject(new Error('Codex discovery process exited'));
});
lines.on('line', (line) => {
  const response = JSON.parse(line);
  if (!pending.has(response.id)) return;
  const entry = pending.get(response.id);
  pending.delete(response.id);
  if (response.error) entry.reject(new Error(JSON.stringify(response.error)));
  else entry.resolve(response.result);
});
function request(method, params) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    pending.set(key, { resolve, reject });
    child.stdin.write(JSON.stringify({ id: key, method, params }) + '\n');
  });
}
const timer = setTimeout(() => child.kill(), 30000);
try {
  await request('initialize', {
    clientInfo: { name: 'ratatoskr-install-check', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const skills = await request('skills/list', {
    cwds: [process.cwd()],
    forceReload: true,
  });
  const inventory = skills.data.flatMap((entry) => entry.skills);
  const skill = inventory.find(
    (entry) => entry.name === 'ratatoskr' || entry.name.endsWith(':ratatoskr'),
  );
  if (!skill) process.stderr.write(JSON.stringify(skills) + '\n');
  assert(skill, 'Ratatoskr skill not discovered');
  const servers = await request('mcpServerStatus/list', {});
  const rat = servers.data.find((entry) => entry.name.includes('ratatoskr'));
  if (!rat || Object.keys(rat.tools).length !== 3)
    process.stderr.write(JSON.stringify(servers) + '\n');
  assert(
    rat && Object.keys(rat.tools).length === 3,
    'Ratatoskr MCP tools not discovered',
  );
  process.stdout.write(
    JSON.stringify({
      skill: { name: skill.name, path: skill.path },
      server: rat.name,
      tools: Object.keys(rat.tools),
    }) + '\n',
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Discovery failed'}\n`,
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  child.stdin.end();
  child.kill();
  lines.close();
}
