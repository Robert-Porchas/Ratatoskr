import type { Client } from '@modelcontextprotocol/client';
type DiscoveredTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown> | undefined;
  annotations?: DiscoveredTool['annotations'];
  title?: DiscoveredTool['title'];
}
export interface ToolReply {
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
  mcpResult?: Awaited<ReturnType<Client['callTool']>>;
}
export interface BrowserSession {
  tools: ToolDefinition[];
  call(name: string, args: Record<string, unknown>): Promise<ToolReply>;
  close(): Promise<void>;
  metrics(): Promise<{
    rawEvidenceBytes: number;
    artifactBytes: number;
    browserInteractions: number;
  }>;
}
export const bytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value));
