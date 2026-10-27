import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { killTree } from '@tutordesk/core';
import type { ApprovalDecision, ApprovalKind, HarnessEvent, HarnessId, HarnessSession, PermissionMode, SessionStart, UserTurn } from './types.js';

/** A push-based async iterable: producers push, one consumer iterates until end(). */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private done = false;

  push(item: T): void {
    if (this.done) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }

  get ended(): boolean {
    return this.done;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/** Kill the agent's process tree and wait until it has exited (its files and cwd are released). */
export async function stopProcess(child: ChildProcess, timeoutMs = 5000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  killTree(child);
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

/** What an agent is about to do, as far as permissions care (appendix E.6). */
export type ActionKind = 'read' | 'toolbox' | ApprovalKind;

/** The permission table: reading and the tutordesk tools are always fine; the rest depends on the mode. */
export function decide(mode: PermissionMode, kind: ActionKind): ApprovalDecision | 'ask' {
  if (kind === 'read' || kind === 'toolbox') return 'allow';
  if (mode === 'full') return 'allow';
  if (mode === 'guarded') return 'deny';
  return 'ask';
}

/** Tool names arrive as mcp__tutordesk__save_plan (Claude), tutordesk_save_plan (OpenCode) or server + tool (Codex). */
export function splitToolName(raw: string): { server?: string; name: string } {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(raw);
  if (mcp) return { server: mcp[1], name: mcp[2]! };
  const td = /^tutordesk[_.](.+)$/.exec(raw);
  if (td) return { server: 'tutordesk', name: td[1]! };
  return { name: raw };
}

/**
 * What an agent may edit directly outside full mode: Markdown inside a student's folder, except the
 * tutor's own notes.md (agents add notes through append_note). `rel` is relative to the workspace.
 */
export function editableByAgent(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) return false;
  return /^students\/[^/]+\/.+\.md$/i.test(p) && !/^students\/[^/]+\/notes\.md$/i.test(p);
}

/** Keys TutorDesk itself uses for API mode; agent processes have their own sign-in and never need them. */
const TUTORDESK_KEYS = ['TUTORDESK_API_KEY', 'OPENROUTER_API_KEY'];

/** The environment for an agent process: the user's own, minus TutorDesk's API keys. */
export function agentEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  for (const k of TUTORDESK_KEYS) delete env[k];
  return env;
}

export const GUARDED_DENIAL = 'Not allowed in this workspace: read files freely, but save lesson documents, reviews, materials and notes with the tutordesk tools.';

/**
 * Turn bookkeeping and approvals shared by every adapter. Subclasses start the agent, translate its
 * protocol into HarnessEvents with emit(), and call endTurn() when the agent finishes a turn.
 */
export abstract class BaseSession implements HarnessSession {
  abstract readonly harness: HarnessId;
  nativeId: string | null;
  private turn: AsyncQueue<HarnessEvent> | null = null;
  private pending = new Map<string, (d: ApprovalDecision) => void>();
  private announced = false;
  private everCompleted = false;
  private isDead = false;
  protected model: string | undefined;

  constructor(protected readonly opts: SessionStart) {
    this.nativeId = opts.resume ?? null;
  }

  abstract start(): Promise<void>;
  protected abstract beginTurn(input: UserTurn): Promise<void>;
  abstract interrupt(): Promise<void>;
  abstract close(): Promise<void>;

  get busy(): boolean {
    return this.turn !== null;
  }

  /** The agent process is gone (crashed, exited, closed): this session cannot take another turn. */
  get dead(): boolean {
    return this.isDead;
  }

  /** At least one turn finished normally, so a resumed native session id is known to be good. */
  get proven(): boolean {
    return this.everCompleted;
  }

  /** Subclasses call this when the agent can no longer answer; the current turn fails. */
  protected markDead(reason: string): void {
    this.isDead = true;
    this.endTurn('failed', reason);
  }

  send(input: UserTurn): AsyncIterable<HarnessEvent> {
    if (this.isDead) throw new Error('The agent has stopped; start the conversation again.');
    if (this.turn) throw new Error('The agent is still working on the previous message.');
    const q = new AsyncQueue<HarnessEvent>();
    this.turn = q;
    if (this.nativeId && !this.announced) this.announce(this.nativeId);
    this.beginTurn(input).catch((e: unknown) => this.endTurn('failed', (e as Error).message));
    return q;
  }

  /** Record the native session id and tell the UI once. */
  protected announce(nativeId: string, model?: string): void {
    this.nativeId = nativeId;
    if (model) this.model = model;
    if (this.announced || !this.turn) return;
    this.announced = true;
    this.emit({ type: 'session', nativeId, model: this.model });
  }

  protected emit(e: HarnessEvent): void {
    this.turn?.push(e);
  }

  protected endTurn(status: 'completed' | 'interrupted' | 'failed', error?: string): void {
    const q = this.turn;
    if (!q) return;
    this.turn = null;
    if (status === 'completed') this.everCompleted = true;
    // An approval nobody answered must not hang the agent after its turn is over.
    this.cancelPending();
    q.push({ type: 'turn_end', status, error });
    q.end();
  }

  /** Decline every approval still waiting; interrupting must not leave the agent blocked on one. */
  protected cancelPending(): void {
    for (const resolve of this.pending.values()) resolve('deny');
    this.pending.clear();
  }

  respond(requestId: string, decision: ApprovalDecision): void {
    const resolve = this.pending.get(requestId);
    if (!resolve) return;
    this.pending.delete(requestId);
    resolve(decision);
  }

  /** Apply the mode's table; ask the tutor only when the table says so. */
  protected async authorize(kind: ActionKind, title: string, detail?: string): Promise<ApprovalDecision> {
    const d = decide(this.opts.mode, kind);
    if (d !== 'ask') return d;
    if (!this.turn) return 'deny';
    const requestId = randomUUID();
    const answer = new Promise<ApprovalDecision>((resolve) => this.pending.set(requestId, resolve));
    this.emit({ type: 'approval', requestId, kind: kind === 'read' || kind === 'toolbox' ? 'other' : kind, title, detail });
    return answer;
  }
}
