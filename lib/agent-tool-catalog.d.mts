export interface AgentToolSchema {
  type: string | string[];
  properties?: Record<string, AgentToolSchema>;
  required?: string[];
  items?: AgentToolSchema;
  description?: string;
  enum?: unknown[];
  [key: string]: unknown;
}
export interface AgentToolDefinition {
  effect: "read" | "write" | "proposal";
  hosts: string[];
  description: string;
  inputSchema: AgentToolSchema;
}
export declare function buildAgentToolCatalog(options?: { locale?: string; host?: string }): Record<string, AgentToolDefinition>;
export declare function getAgentToolDefinition(name: string, options?: { locale?: string; host?: string }): AgentToolDefinition;
export declare function normalizeAgentToolCall(call: Record<string, unknown>): Record<string, unknown> & { tool: string };
export declare function formatAgentToolGuide(options?: { locale?: string; host?: string; turnKind?: "light" | "query" | "task"; allowedTools?: string[] }): string;
export declare const AI_TOOL_NAMES_READ: readonly string[];
export declare const AI_TOOL_NAMES_WRITE: readonly string[];

export declare function filterAgentToolsForTurn<T>(tools: Record<string, T>, kind: "light" | "query" | "task"): Record<string, T>;
