import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { measureCodexTools } from '../benchmarks/browser-evidence/codex-observations.js';

it('counts the SDK validation error excluded by the old handler-only counter', async () => {
  const raw = await readFile(
    'benchmarks/browser-evidence/codex-sample/ratatoskr-1/codex-events.jsonl',
    'utf8',
  );
  const measurement = measureCodexTools(
    raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );
  expect(measurement.interactions).toHaveLength(5);
  expect(measurement.invalidToolCalls).toBe(2);
  expect(measurement.maxToolErrorBytes).toBe(13950);
  expect(measurement.toolResultBytes).toBe(16728);
});

it('counts structured, text, image, and transport errors without duplicating started events', () => {
  const item = {
    type: 'mcp_tool_call',
    tool: 'test',
    arguments: {},
    status: 'failed',
    result: {
      content: [
        { type: 'text', text: 'bad' },
        { type: 'image', data: 'abcd' },
      ],
      structured_content: { error: 'bad' },
      is_error: true,
    },
  };
  const measurement = measureCodexTools([
    { type: 'item.started', item },
    { type: 'item.completed', item },
  ]);
  expect(measurement.toolResultBytes).toBe(
    3 + 4 + JSON.stringify({ error: 'bad' }).length,
  );
  expect(measurement.invalidToolCalls).toBe(1);
  expect(measurement.toolArgumentBytes).toBe(2);
});
