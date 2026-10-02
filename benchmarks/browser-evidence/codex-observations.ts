import { z } from 'zod';
import type { Interaction } from './agent.js';
import type { ToolDefinition } from './tools.js';

const itemSchema = z.object({
  type: z.literal('mcp_tool_call'),
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  status: z.string(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

/** Count terminal MCP events, including SDK rejection before the handler is entered. */
export function measureCodexTools(events: Array<Record<string, unknown>>) {
  const interactions: Interaction[] = [];
  let invalidToolCalls = 0,
    toolArgumentBytes = 0,
    toolResultBytes = 0,
    maxToolErrorBytes = 0;
  for (const event of events) {
    if (event.type !== 'item.completed') continue;
    const parsed = itemSchema.safeParse(event.item);
    if (!parsed.success) continue;
    const item = parsed.data;
    const result = z
      .object({
        content: z.array(z.record(z.string(), z.unknown())).optional(),
        structured_content: z.unknown().optional(),
        structuredContent: z.unknown().optional(),
        isError: z.boolean().optional(),
        is_error: z.boolean().optional(),
      })
      .passthrough()
      .safeParse(item.result);
    const texts = result.success
      ? (result.data.content ?? []).flatMap((block) =>
          block.type === 'text' && typeof block.text === 'string'
            ? [block.text]
            : [],
        )
      : [];
    const structured = result.success
      ? (result.data.structured_content ?? result.data.structuredContent)
      : undefined;
    const text = texts.join('\n');
    const failed =
      item.status === 'failed' ||
      Boolean(item.error) ||
      (result.success && (result.data.isError || result.data.is_error)) ||
      /"error"\s*:|INVALID_PLAN|Input validation error/.test(text);
    const payloadBytes =
      texts.reduce((sum, value) => sum + Buffer.byteLength(value), 0) +
      (structured == null ? 0 : Buffer.byteLength(JSON.stringify(structured))) +
      (result.success
        ? (result.data.content ?? []).reduce(
            (sum, block) =>
              sum +
              (block.type === 'image' && typeof block.data === 'string'
                ? Buffer.byteLength(block.data)
                : 0),
            0,
          )
        : 0) +
      (item.error ? Buffer.byteLength(JSON.stringify(item.error)) : 0);
    toolArgumentBytes += Buffer.byteLength(JSON.stringify(item.arguments));
    toolResultBytes += payloadBytes;
    if (failed) {
      invalidToolCalls++;
      maxToolErrorBytes = Math.max(maxToolErrorBytes, payloadBytes);
    }
    interactions.push({
      index: interactions.length + 1,
      name: item.tool,
      arguments: item.arguments,
      reply: {
        text:
          structured == null
            ? text
            : JSON.stringify({ content: texts, structuredContent: structured }),
      },
      durationMs: 0,
    });
  }
  return {
    interactions,
    invalidToolCalls,
    toolArgumentBytes,
    toolResultBytes,
    maxToolErrorBytes,
  };
}

export function measureSchemas(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    inputSchemaBytes: Buffer.byteLength(JSON.stringify(tool.inputSchema)),
    descriptionBytes: Buffer.byteLength(tool.description),
    definitionBytes: Buffer.byteLength(JSON.stringify(tool)),
  }));
}
