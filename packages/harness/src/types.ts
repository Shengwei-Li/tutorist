/**
 * Conversational sessions with a local coding agent (appendix E.3). One interface for Claude Code,
 * Codex and ACP agents (OpenCode); TutorDesk's teaching tools reach the agent over MCP.
 */
/** Local coding agents TutorDesk starts as processes. */
export type CliHarnessId = 'claude-code' | 'codex' | 'opencode';
/** 'api' is TutorDesk's own loop over a model reached by API key (H6). */
export type HarnessId = CliHarnessId | 'api';

/**
 * guarded: the agent reads the workspace and writes only through the tutordesk tools.
 * collaborate: it may also edit Markdown in student folders, each edit approved by the tutor; no commands.
 * full: no prompts (the author's own use, batch jobs).
 */
export type PermissionMode = 'guarded' | 'collaborate' | 'full';

/** How the agent starts the tutordesk MCP server (appendix E.4.3). */
export interface McpLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface SessionStart {
  /** Workspace root: the agent's working directory. */
  cwd: string;
  mode: PermissionMode;
  /** Native session or thread id to continue. */
  resume?: string;
  /** Omit to use the harness's own default (the model in the user's subscription). */
  model?: string;
  /** Appended to the agent's system instructions: which student and lesson this thread is about. */
  instructions?: string;
  mcp: McpLaunch;
  /** Extra environment for the agent process. */
  env?: NodeJS.ProcessEnv;
}

export interface UserTurn {
  text: string;
  /** Absolute paths of images the agent should see (e.g. a photographed essay). */
  images?: string[];
}

export type ApprovalDecision = 'allow' | 'deny';

export type ApprovalKind = 'command' | 'edit' | 'network' | 'tool' | 'other';

export type HarnessEvent =
  | { type: 'session'; nativeId: string; model?: string }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool'; id: string; server?: string; name: string; input?: unknown; status: 'running' | 'ok' | 'error'; summary?: string }
  | { type: 'file'; path: string; op: 'create' | 'edit' | 'delete' }
  | { type: 'approval'; requestId: string; kind: ApprovalKind; title: string; detail?: string }
  | { type: 'notice'; level: 'info' | 'warning'; message: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens?: number; usd?: number }
  | { type: 'turn_end'; status: 'completed' | 'interrupted' | 'failed'; error?: string };

export interface HarnessSession {
  readonly harness: HarnessId;
  /** Known after start (Codex, ACP) or after the first turn begins (Claude Code). */
  readonly nativeId: string | null;
  /** The agent process has gone; a new session is needed for the next message. */
  readonly dead: boolean;
  /** A turn has completed in this session (so the native id it resumed is valid). */
  readonly proven: boolean;
  start(): Promise<void>;
  /** One turn. Events stream until a `turn_end`; only one turn runs at a time. */
  send(input: UserTurn): AsyncIterable<HarnessEvent>;
  respond(requestId: string, decision: ApprovalDecision): void;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

/** A model an agent offers the tutor's account, under the agent's own name for it. */
export interface ModelChoice {
  /** What the agent takes as its model setting. */
  id: string;
  label: string;
  description?: string;
}

export interface ModelList {
  models: ModelChoice[];
  /** The model the agent uses when none is chosen, when it says. */
  defaultLabel?: string;
}

export interface HarnessHealth {
  harness: CliHarnessId;
  installed: boolean;
  version?: string;
  /** undefined when the harness gives no way to check without starting a session. */
  authed?: boolean;
  executable?: string;
  /** Plain-language next step for the tutor when something is missing. */
  detail?: string;
}
