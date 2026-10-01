export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface ToolReply {
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
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
