import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ContentBlock,
  InitializeResponse,
  LoadSessionResponse,
  NewSessionResponse,
  PermissionOption,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionNotification,
  ToolKind,
} from '@agentclientprotocol/sdk';
import { which, type ResolvedCommand } from '@tutordesk/core';
import { JsonRpcPeer, RpcError } from './jsonrpc.js';
import { BaseSession, agentEnv, splitToolName, type ActionKind, stopProcess } from './session-base.js';
import type { PermissionMode, SessionStart, UserTurn } from './types.js';

export const ACP_PROTOCOL_VERSION = 1;

const MEDIA: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/**
 * The tool's kind decides first: a title is free text the agent can shape, so a shell command whose
 * title happens to start with "tutordesk_" must still count as a command.
 */
export function classify(kind: ToolKind | null | undefined, title: string): ActionKind {
  switch (kind) {
    case 'read':
    case 'search':
    case 'think':
      return 'read';
    case 'edit':
    case 'delete':
    case 'move':
      return 'edit';
    case 'execute':
      return 'command';
    case 'fetch':
      return 'network';
    default:
      return /^tutordesk_[a-z_]+$/.test(title) || /^mcp__tutordesk__[a-z_]+$/.test(title) ? 'toolbox' : 'other';
  }
}

/**
 * OpenCode's own permission rules, passed inline (OPENCODE_CONFIG_CONTENT). In guarded mode the agent
 * cannot edit or run anything, so the only way to write is the tutordesk toolbox.
 */
export function opencodePermissionConfig(mode: PermissionMode): string {
  const edit = mode === 'guarded' ? 'deny' : mode === 'collaborate' ? 'ask' : 'allow';
  // Commands need full mode (see decide()).
  const other = mode === 'full' ? 'allow' : 'deny';
  return JSON.stringify({ permission: { edit, bash: other, webfetch: other } });
}

export interface AcpAgentSpec {
  /** Display id; 'opencode' is the one TutorDesk ships with. */
  harness: 'opencode';
  executable?: ResolvedCommand;
  /** Program name looked up on PATH when no executable is given. */
  program: string;
  args: string[];
  env?: (mode: PermissionMode) => Record<string, string>;
}

export const OPENCODE_ACP: AcpAgentSpec = {
  harness: 'opencode',
  program: 'opencode',
  args: ['acp'],
  env: (mode) => ({ OPENCODE_CONFIG_CONTENT: opencodePermissionConfig(mode) }),
};

/**
 * Any Agent Client Protocol agent over stdio (OpenCode natively; Gemini CLI, claude-code-acp and
 * codex-acp the same way). Plain JSON-RPC, so no SDK runtime is needed: only its protocol types.
 */
export class AcpSession extends BaseSession {
  readonly harness: 'opencode';
  private peer: JsonRpcPeer | undefined;
  private child: ChildProcessWithoutNullStreams | undefined;
  private caps: InitializeResponse | undefined;
  /** session/load replays history as updates; those are not part of the current turn. */
  private loading = false;
  private toolTitles = new Map<string, string>();

  constructor(
    opts: SessionStart,
    private readonly agent: AcpAgentSpec = OPENCODE_ACP,
  ) {
    super(opts);
    this.harness = agent.harness;
  }

  async start(): Promise<void> {
    const exe = this.agent.executable ?? (await which(this.agent.program, this.opts.env));
    if (!exe) throw new Error(`${this.agent.program} is not installed.`);
    const env = { ...agentEnv(this.opts.env), ...this.agent.env?.(this.opts.mode) };
    const child = spawn(exe.command, [...exe.prefixArgs, ...this.agent.args], { cwd: this.opts.cwd, env, windowsHide: true });
    this.child = child;
    try {
      await this.handshake(child);
    } catch (e) {
      await stopProcess(child);
      throw e;
    }
  }

  private async handshake(child: ChildProcessWithoutNullStreams): Promise<void> {
    const peer = new JsonRpcPeer(child, { header: true });
    this.peer = peer;
    peer.onNotification = (method, params) => {
      if (method === 'session/update') this.onUpdate(params as SessionNotification);
    };
    peer.onRequest = (method, params) => this.onAgentRequest(method, params);
    peer.onClose = (reason) => this.markDead(`${this.agent.program} ${reason}`);

    this.caps = await peer.request<InitializeResponse>('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      // We do not offer our file system or terminal: the agent works in the workspace itself.
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'tutordesk', title: 'TutorDesk', version: '0.1.0' },
    });
    const mcpServers = [
      { name: 'tutordesk', command: this.opts.mcp.command, args: this.opts.mcp.args, env: Object.entries(this.opts.mcp.env ?? {}).map(([name, value]) => ({ name, value })) },
    ];
    let options: SessionConfigOption[] | undefined;
    if (this.opts.resume && this.caps.agentCapabilities?.loadSession) {
      this.loading = true;
      try {
        const r = await peer.request<LoadSessionResponse | null>('session/load', { sessionId: this.opts.resume, cwd: this.opts.cwd, mcpServers });
        options = r?.configOptions ?? undefined;
      } finally {
        this.loading = false;
      }
      this.nativeId = this.opts.resume;
      this.resumed = true;
    } else {
      const r = await peer.request<NewSessionResponse>('session/new', { cwd: this.opts.cwd, mcpServers });
      this.nativeId = r.sessionId;
      options = r.configOptions ?? undefined;
    }
    if (this.opts.model) await this.chooseModel(peer, this.opts.model, options);
  }

  /** ACP has no model parameter: the agent offers it as a session config option of category "model". */
  private async chooseModel(peer: JsonRpcPeer, model: string, options: SessionConfigOption[] | undefined): Promise<void> {
    const option = options?.find((o) => o.category === 'model');
    if (option?.type === 'select' && option.currentValue === model) return;
    await peer.request('session/set_config_option', { sessionId: this.nativeId, configId: option?.id ?? 'model', value: model });
  }

  protected async beginTurn(input: UserTurn): Promise<void> {
    if (!this.peer || !this.nativeId) throw new Error('Session not started');
    const prompt: ContentBlock[] = [];
    // ACP has no system prompt; the thread's instructions ride on its first message.
    if (this.opts.instructions && !this.resumed && !this.sentFirst) prompt.push({ type: 'text', text: `${this.opts.instructions}\n\n---\n\n` });
    this.sentFirst = true;
    prompt.push({ type: 'text', text: input.text });
    for (const img of input.images ?? []) {
      if (!this.caps?.agentCapabilities?.promptCapabilities?.image) throw new Error(`${this.agent.program} cannot take images in a prompt.`);
      const mimeType = MEDIA[path.extname(img).toLowerCase()];
      if (!mimeType) throw new Error(`Unsupported image type: ${img}`);
      prompt.push({ type: 'image', mimeType, data: (await readFile(img)).toString('base64') });
    }
    const r = await this.peer.request<PromptResponse>('session/prompt', { sessionId: this.nativeId, prompt });
    if (r.stopReason === 'cancelled') this.endTurn('interrupted');
    else if (r.stopReason === 'refusal') this.endTurn('failed', 'The agent refused this request.');
    else this.endTurn('completed', r.stopReason === 'end_turn' ? undefined : `Stopped: ${r.stopReason}`);
  }
  private sentFirst = false;
  /** The agent loaded an earlier session (it may not support loading, and then starts afresh). */
  private resumed = false;

  private onUpdate(n: SessionNotification): void {
    if (this.loading || n.sessionId !== this.nativeId) return;
    const u = n.update;
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
        if (u.content.type === 'text') this.emit({ type: 'text', delta: u.content.text });
        return;
      case 'agent_thought_chunk':
        if (u.content.type === 'text') this.emit({ type: 'reasoning', delta: u.content.text });
        return;
      case 'tool_call': {
        const raw = u.title;
        this.toolTitles.set(u.toolCallId, raw);
        this.emit({ type: 'tool', id: u.toolCallId, ...splitToolName(raw), input: u.rawInput, status: u.status === 'failed' ? 'error' : u.status === 'completed' ? 'ok' : 'running' });
        return;
      }
      case 'tool_call_update': {
        if (u.status !== 'completed' && u.status !== 'failed') return;
        const raw = u.title ?? this.toolTitles.get(u.toolCallId) ?? 'tool';
        const text = (u.content ?? [])
          .map((c) => (c.type === 'content' && c.content.type === 'text' ? c.content.text : ''))
          .join(' ')
          .slice(0, 400);
        this.emit({ type: 'tool', id: u.toolCallId, ...splitToolName(raw), status: u.status === 'failed' ? 'error' : 'ok', summary: text || undefined });
        for (const c of u.content ?? []) {
          if (c.type === 'diff') this.emit({ type: 'file', path: path.relative(this.opts.cwd, path.resolve(this.opts.cwd, c.path)).replace(/\\/g, '/'), op: c.oldText == null ? 'create' : 'edit' });
        }
        return;
      }
      default:
        return;
    }
  }

  private async onAgentRequest(method: string, params: unknown): Promise<unknown> {
    if (method !== 'session/request_permission') throw new RpcError(-32601, `TutorDesk does not provide ${method}`);
    const req = params as RequestPermissionRequest;
    const title = req.toolCall.title ?? 'a tool';
    const d = await this.authorize(classify(req.toolCall.kind, title), title);
    const pick = (kinds: PermissionOption['kind'][]) => req.options.find((o) => kinds.includes(o.kind));
    const option = d === 'allow' ? pick(['allow_once', 'allow_always']) : pick(['reject_once', 'reject_always']);
    const response: RequestPermissionResponse = option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } };
    return response;
  }

  async interrupt(): Promise<void> {
    if (!this.peer || !this.nativeId || !this.busy) return;
    // ACP: after cancelling, the client answers any permission request still open.
    this.cancelPending();
    this.peer.notify('session/cancel', { sessionId: this.nativeId });
  }

  async close(): Promise<void> {
    this.endTurn('interrupted');
    this.markDead('Closed.');
    if (this.child) await stopProcess(this.child);
  }
}
