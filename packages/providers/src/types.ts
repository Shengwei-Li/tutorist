/** Agent provider contract (SPEC §7.2). Mode A = local CLIs on the user's subscription; mode B = API keys. */
export type ProviderId = 'claude-cli' | 'codex-cli' | 'opencode-cli' | 'api';

export type TaskType = 'diagnose' | 'plan' | 'generate' | 'review' | 'revise' | 'extract' | 'freeform';

export interface PermissionPolicy {
  /** Root-relative globs the agent may write, e.g. `lessons/2026-10-26-L04/**`. */
  writableGlobs: string[];
  readableGlobs: string[];
  allowShell: boolean;
  allowNetwork: boolean;
}

/** Provider-neutral model choice; each provider maps tiers to concrete models (SPEC §7.7). */
export type ModelTier = 'quality' | 'balanced' | 'fast';

export interface Attachment {
  /** Absolute path inside workspaceRoot. */
  path: string;
  mediaType: string;
}

export interface AgentRunSpec {
  taskType: TaskType;
  /** Student folder: the agent's cwd and sandbox root. */
  workspaceRoot: string;
  prompt: string;
  systemAppend?: string;
  /** Tool names to enable; defaults depend on taskType (no tools for extract/review). */
  tools?: string[];
  /** JSON Schema the final answer must satisfy. */
  outputSchema?: Record<string, unknown>;
  /** A tier, or a provider-specific model id. */
  model?: ModelTier | (string & {});
  /** Images or PDFs the model must see (e.g. a photographed essay). */
  attachments?: Attachment[];
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  resumeSessionId?: string;
  budget?: { maxUsd?: number; maxTurns?: number };
  permissions: PermissionPolicy;
}

export type AgentEvent =
  | { type: 'init'; sessionId: string; model?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; summary?: string }
  | { type: 'file_changed'; path: string; op: 'create' | 'edit' | 'delete' }
  | { type: 'policy_violation'; path: string; tool: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheRead: number; usd?: number }
  | { type: 'done'; sessionId: string; structured?: unknown; finalText: string; turns?: number }
  | { type: 'error'; message: string; retryable: boolean; sessionId?: string };

export interface ProviderCapabilities {
  structuredOutput: boolean;
  subagents: boolean;
  skills: boolean;
  resume: boolean;
  authModes: ('apiKey' | 'subscription')[];
}

export interface HealthStatus {
  ok: boolean;
  installed: boolean;
  version?: string;
  authed: boolean;
  authMethod?: string;
  executable?: string;
  /** Plain-language next step for the teacher when not ok. */
  detail?: string;
}

export interface AgentProvider {
  id: ProviderId;
  capabilities(): Promise<ProviderCapabilities>;
  healthCheck(): Promise<HealthStatus>;
  run(spec: AgentRunSpec, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

export const DEFAULT_TOOLS: Record<TaskType, string[]> = {
  diagnose: ['Read', 'Glob', 'Grep'],
  plan: ['Read', 'Glob', 'Grep'],
  generate: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
  review: [],
  revise: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
  extract: [],
  freeform: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
};

export const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
