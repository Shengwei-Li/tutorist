import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { which, type ResolvedCommand } from '@tutordesk/core';
import { JsonRpcPeer } from './jsonrpc.js';
import { BaseSession, agentEnv, editableByAgent, stopProcess } from './session-base.js';
import type { PermissionMode, SessionStart, UserTurn } from './types.js';

/**
 * The slice of the Codex app-server protocol TutorDesk uses (v2 thread API). Generate the full,
 * version-exact types with `codex app-server generate-ts --out <dir>`; checked against codex-cli 0.160.
 */
export const CODEX_TESTED_VERSION = '0.160.1';

type CodexItem =
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'mcpToolCall'; id: string; server: string; tool: string; status: 'inProgress' | 'completed' | 'failed'; arguments: unknown; result?: unknown; error?: { message?: string } | null }
  | { type: 'commandExecution'; id: string; command: string; aggregatedOutput?: string | null; exitCode?: number | null }
  | { type: 'fileChange'; id: string; changes: { path: string; kind: { type: 'add' | 'delete' | 'update' } }[]; status: string }
  | { type: string; id: string };

interface Turn {
  id: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: { message: string } | null;
}

const SANDBOX: Record<PermissionMode, { sandbox: 'read-only' | 'workspace-write'; approvalPolicy: 'on-request' | 'untrusted' | 'never' }> = {
  // Reading needs no approval; anything else is declined, so writes happen only through tutordesk tools.
  guarded: { sandbox: 'read-only', approvalPolicy: 'on-request' },
  collaborate: { sandbox: 'workspace-write', approvalPolicy: 'untrusted' },
  full: { sandbox: 'workspace-write', approvalPolicy: 'never' },
};

function resultText(result: unknown): string | undefined {
  const content = (result as { content?: { type?: string; text?: string }[] } | undefined)?.content;
  return content?.map((c) => c.text ?? '').join(' ').slice(0, 400) || undefined;
}

/** Codex through `codex app-server`: one process per thread, JSON-RPC over stdio (as t3code does). */
export class CodexSession extends BaseSession {
  readonly harness = 'codex' as const;
  private peer: JsonRpcPeer | undefined;
  private child: ChildProcessWithoutNullStreams | undefined;
  private turnId: string | null = null;
  private streamed = new Set<string>();
  /** Codex splits a reply into several messages (a preamble, then the answer); keep them apart. */
  private lastTextItem: string | null = null;
  private usage: { inputTokens: number; outputTokens: number; cachedTokens: number } | null = null;
  private lastError: string | undefined;
  /** Paths each pending fileChange item will touch, so its approval can name them. */
  private changes = new Map<string, string[]>();

  constructor(
    opts: SessionStart,
    private readonly extra: { executable?: ResolvedCommand; version?: string } = {},
  ) {
    super(opts);
  }

  async start(): Promise<void> {
    const exe = this.extra.executable ?? (await which('codex', this.opts.env));
    if (!exe) throw new Error('Codex is not installed.');
    const child = spawn(exe.command, [...exe.prefixArgs, 'app-server'], { cwd: this.opts.cwd, env: agentEnv(this.opts.env), windowsHide: true });
    this.child = child;
    try {
      await this.handshake(child);
    } catch (e) {
      await stopProcess(child);
      throw e;
    }
  }

  private async handshake(child: ChildProcessWithoutNullStreams): Promise<void> {
    const peer = new JsonRpcPeer(child, { header: false });
    this.peer = peer;
    peer.onNotification = (method, params) => this.onNotification(method, params);
    peer.onRequest = (method, params) => this.onServerRequest(method, params);
    peer.onClose = (reason) => this.markDead(`Codex ${reason}`);

    await peer.request('initialize', { clientInfo: { name: 'tutordesk', title: 'TutorDesk', version: this.extra.version ?? '0.1.0' }, capabilities: null });
    peer.notify('initialized');
    const { sandbox, approvalPolicy } = SANDBOX[this.opts.mode];
    const params = {
      cwd: this.opts.cwd,
      model: this.opts.model ?? null,
      sandbox,
      approvalPolicy,
      developerInstructions: this.opts.instructions ?? null,
      config: {
        mcp_servers: { tutordesk: { command: this.opts.mcp.command, args: this.opts.mcp.args, env: this.opts.mcp.env ?? {}, tool_timeout_sec: 300 } },
      },
    };
    const r = this.opts.resume
      ? await peer.request<{ thread: { id: string }; model: string }>('thread/resume', { threadId: this.opts.resume, ...params, excludeTurns: true })
      : await peer.request<{ thread: { id: string }; model: string }>('thread/start', params);
    this.nativeId = r.thread.id;
    this.model = r.model;
  }

  protected async beginTurn(input: UserTurn): Promise<void> {
    if (!this.peer || !this.nativeId) throw new Error('Session not started');
    this.usage = null;
    this.lastError = undefined;
    this.streamed.clear();
    this.lastTextItem = null;
    const items: unknown[] = [{ type: 'text', text: input.text, text_elements: [] }, ...(input.images ?? []).map((p) => ({ type: 'localImage', path: p }))];
    const r = await this.peer.request<{ turn: Turn }>('turn/start', { threadId: this.nativeId, input: items });
    this.turnId = r.turn.id;
  }

  private onNotification(method: string, params: unknown): void {
    const p = params as Record<string, unknown>;
    switch (method) {
      case 'item/agentMessage/delta':
        this.streamed.add(String(p.itemId));
        this.text(String(p.itemId), String(p.delta ?? ''));
        return;
      case 'item/reasoning/summaryTextDelta':
        this.emit({ type: 'reasoning', delta: String(p.delta ?? '') });
        return;
      case 'item/started':
        this.itemStarted(p.item as CodexItem);
        return;
      case 'item/completed':
        this.itemCompleted(p.item as CodexItem);
        return;
      case 'thread/tokenUsage/updated': {
        const last = (p.tokenUsage as { last?: { inputTokens: number; outputTokens: number; cachedInputTokens: number } } | undefined)?.last;
        if (last) {
          this.usage ??= { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
          this.usage.inputTokens += last.inputTokens;
          this.usage.outputTokens += last.outputTokens;
          this.usage.cachedTokens += last.cachedInputTokens;
        }
        return;
      }
      case 'error': {
        const e = p as { error?: { message?: string }; willRetry?: boolean };
        if (!e.willRetry) this.lastError = e.error?.message;
        return;
      }
      case 'turn/completed': {
        const turn = p.turn as Turn;
        if (this.usage) this.emit({ type: 'usage', ...this.usage });
        this.turnId = null;
        this.endTurn(turn.status === 'interrupted' ? 'interrupted' : turn.status === 'failed' ? 'failed' : 'completed', turn.error?.message ?? (turn.status === 'failed' ? this.lastError : undefined));
        return;
      }
      default:
        return;
    }
  }

  private text(itemId: string, delta: string): void {
    if (this.lastTextItem !== null && this.lastTextItem !== itemId) this.emit({ type: 'text', delta: '\n\n' });
    this.lastTextItem = itemId;
    this.emit({ type: 'text', delta });
  }

  private itemStarted(item: CodexItem): void {
    if (item.type === 'mcpToolCall') {
      const it = item as Extract<CodexItem, { type: 'mcpToolCall' }>;
      this.emit({ type: 'tool', id: it.id, server: it.server, name: it.tool, input: it.arguments, status: 'running' });
    } else if (item.type === 'commandExecution') {
      const it = item as Extract<CodexItem, { type: 'commandExecution' }>;
      this.emit({ type: 'tool', id: it.id, name: 'shell', input: { command: it.command }, status: 'running' });
    } else if (item.type === 'fileChange') {
      const it = item as Extract<CodexItem, { type: 'fileChange' }>;
      this.changes.set(it.id, it.changes.map((c) => c.path));
    }
  }

  private itemCompleted(item: CodexItem): void {
    switch (item.type) {
      case 'agentMessage': {
        const it = item as Extract<CodexItem, { type: 'agentMessage' }>;
        // Older servers send the message whole, without deltas.
        if (!this.streamed.has(it.id) && it.text) this.text(it.id, it.text);
        return;
      }
      case 'mcpToolCall': {
        const it = item as Extract<CodexItem, { type: 'mcpToolCall' }>;
        const isError = it.status === 'failed' || (it.result as { isError?: boolean } | undefined)?.isError === true;
        this.emit({ type: 'tool', id: it.id, server: it.server, name: it.tool, status: isError ? 'error' : 'ok', summary: it.error?.message ?? resultText(it.result) });
        return;
      }
      case 'commandExecution': {
        const it = item as Extract<CodexItem, { type: 'commandExecution' }>;
        this.emit({ type: 'tool', id: it.id, name: 'shell', status: it.exitCode === 0 ? 'ok' : 'error', summary: it.aggregatedOutput?.slice(-400) ?? undefined });
        return;
      }
      case 'fileChange': {
        const it = item as Extract<CodexItem, { type: 'fileChange' }>;
        this.changes.delete(it.id);
        if (it.status !== 'completed') return;
        for (const c of it.changes) {
          this.emit({ type: 'file', path: path.relative(this.opts.cwd, path.resolve(this.opts.cwd, c.path)).replace(/\\/g, '/'), op: c.kind.type === 'add' ? 'create' : c.kind.type === 'delete' ? 'delete' : 'edit' });
        }
        return;
      }
      default:
        return;
    }
  }

  private async onServerRequest(method: string, params: unknown): Promise<unknown> {
    const p = params as Record<string, unknown>;
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const d = await this.authorize('command', `Run: ${String(p.command ?? 'a command').slice(0, 200)}`, (p.reason as string | null) ?? undefined);
        return { decision: d === 'allow' ? 'accept' : 'decline' };
      }
      case 'item/fileChange/requestApproval': {
        const d = await this.approveEdit(this.changes.get(String(p.itemId)), (p.reason as string | null) ?? undefined);
        return { decision: d === 'allow' ? 'accept' : 'decline' };
      }
      case 'item/permissions/requestApproval': {
        const d = await this.authorize('other', 'Extra permissions', (p.reason as string | null) ?? undefined);
        // Granting nothing declines; granting is left to full mode, where Codex does not ask.
        return { permissions: d === 'allow' ? ((p.permissions as object | undefined) ?? {}) : {}, scope: 'turn' };
      }
      case 'mcpServer/elicitation/request': {
        if (p.serverName === 'tutordesk') return { action: 'accept', content: null, _meta: null };
        const d = await this.authorize('tool', `Allow ${String(p.serverName)}`, (p.message as string | undefined) ?? undefined);
        return { action: d === 'allow' ? 'accept' : 'decline', content: null, _meta: null };
      }
      case 'item/tool/requestUserInput':
        return { answers: {} };
      case 'execCommandApproval': {
        // Legacy v1 approvals.
        const command = Array.isArray(p.command) ? p.command.join(' ') : String(p.command ?? 'a command');
        const d = await this.authorize('command', `Run: ${command.slice(0, 200)}`);
        return { decision: d === 'allow' ? 'approved' : 'denied' };
      }
      case 'applyPatchApproval': {
        const files = p.fileChanges && typeof p.fileChanges === 'object' ? Object.keys(p.fileChanges) : undefined;
        const d = await this.approveEdit(files);
        return { decision: d === 'allow' ? 'approved' : 'denied' };
      }
      default:
        throw new Error(`TutorDesk does not handle ${method}`);
    }
  }

  /**
   * Collaborate mode lets the agent edit Markdown in student folders and nothing else (as with Claude
   * Code): structured files such as lesson.json go through the tools, which keep the tutor's gates.
   */
  private async approveEdit(files: string[] | undefined, reason?: string): Promise<'allow' | 'deny'> {
    const rel = (files ?? []).map((f) => path.relative(this.opts.cwd, path.resolve(this.opts.cwd, f)).replace(/\\/g, '/'));
    if (this.opts.mode !== 'full' && (!rel.length || !rel.every(editableByAgent))) return 'deny';
    return this.authorize('edit', `Edit ${rel.join(', ').slice(0, 200)}`, reason);
  }

  async interrupt(): Promise<void> {
    this.cancelPending();
    if (!this.peer || !this.nativeId || !this.turnId) return;
    await this.peer.request('turn/interrupt', { threadId: this.nativeId, turnId: this.turnId });
  }

  async close(): Promise<void> {
    this.endTurn('interrupted');
    this.markDead('Closed.');
    if (this.child) await stopProcess(this.child);
  }
}

