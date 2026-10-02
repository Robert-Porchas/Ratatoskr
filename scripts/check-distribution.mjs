import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { projectRoot } from './runtime.mjs';

const json = async (path) =>
  JSON.parse(await readFile(join(projectRoot, path), 'utf8'));
const metadata = await json('package.json');
const manifest = await json('.codex-plugin/plugin.json');
const mcp = await json('.mcp.json');
const marketplace = await json('.claude-plugin/marketplace.json');
assert.equal(manifest.name, metadata.name);
assert.equal(manifest.version, metadata.version);
assert.equal(manifest.license, metadata.license);
assert.equal(metadata.license, 'MIT');
assert.equal(manifest.skills, './skills/');
assert.equal(manifest.mcpServers, './.mcp.json');
assert.equal(marketplace.plugins[0].source.path, './dist/plugin');
assert.deepEqual(mcp.mcpServers.ratatoskr.args, ['scripts/mcp.mjs']);
assert(mcp.mcpServers.ratatoskr.tool_timeout_sec > 180);
assert(!mcp.mcpServers.ratatoskr.env);
const skill = await readFile(
  join(projectRoot, 'skills/ratatoskr/SKILL.md'),
  'utf8',
);
assert(/^---\nname: ratatoskr\ndescription: [^\n]+\n---\n/.test(skill));
assert(Buffer.byteLength(skill) < 3000, 'Keep the operational skill concise');
const staged = await json('dist/plugin/.codex-plugin/plugin.json');
assert.deepEqual(staged, manifest);
assert.deepEqual((await readdir(join(projectRoot, 'dist/plugin'))).sort(), [
  '.codex-plugin',
  '.mcp.json',
  'scripts',
  'skills',
]);
const npm = process.env.npm_execpath;
assert(npm, 'Run with npm run test:dist');
const pack = spawnSync(
  process.execPath,
  [npm, 'pack', '--dry-run', '--json', '--ignore-scripts'],
  { cwd: projectRoot, encoding: 'utf8' },
);
assert.equal(pack.status, 0, pack.stderr);
const packed = JSON.parse(pack.stdout);
const entry = Array.isArray(packed) ? packed[0] : packed[metadata.name];
assert(
  entry && Array.isArray(entry.files),
  'npm pack returned no package inventory',
);
const files = entry.files.map((file) => file.path);
assert(files.includes('dist/src/mcp/server.js'));
assert(files.includes('LICENSE'));
for (const file of files)
  assert(
    !/(^|\/)(node_modules|test|benchmarks|\.env[^/]*|\.ratatoskr|\.codex)(\/|$)|\.(zip|png|jsonl|log)$/.test(
      file,
    ),
    `Unexpected package file: ${file}`,
  );
process.stdout.write(
  `${JSON.stringify({ version: metadata.version, skillBytes: Buffer.byteLength(skill), skillMetadataBytes: Buffer.byteLength(skill.split('---')[1]), packageFiles: files.length, packageBytes: entry.unpackedSize })}\n`,
);
