import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { LineSplitter } from '@tutordesk/core';

type Id = number | string;

interface Message {
  jsonrpc?: '2.0';
  id?: Id | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/**
 * Newline-delimited JSON-RPC over a child's stdio, both directions (requests from the agent too).
 * Codex app-server omits the "jsonrpc" header; ACP agents expect it.
 */
export class JsonRpcPeer {
  private nextId = 1;
  private waiting = new Map<Id, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private closed = false;
  onRequest: (method: string, params: unknown) => Promise<unknown> = async (method) => {
    throw new RpcError(-32601, `Method not supported by TutorDesk: ${method}`);
  };
  onNotification: (method: string, params: unknown) => void = () => {};
  onClose: (reason: string) => void = () => {};
  /** Last lines of stderr, for error messages when the process dies. */
  stderrTail = '';

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly o: { header: boolean },
  ) {
    const lines = new LineSplitter();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of lines.push(chunk)) this.handle(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4000);
    });
    child.on('error', (e) => this.shutdown(e.message));
    child.on('close', (code) => this.shutdown(`exited with code ${code}${this.stderrTail ? `: ${this.stderrTail.trim().split('\n').slice(-3).join(' | ')}` : ''}`));
  }

  private shutdown(reason: string) {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiting.values()) w.reject(new Error(`Agent process ${reason}`));
    this.waiting.clear();
    this.onClose(reason);
  }

  private write(msg: Message) {
    if (this.closed) throw new Error('Agent process is not running');
    this.child.stdin.write(`${JSON.stringify(this.o.header ? { jsonrpc: '2.0', ...msg } : msg)}\n`);
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        this.write({ id, method, params });
      } catch (e) {
        this.waiting.delete(id);
        reject(e as Error);
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  private handle(line: string) {
    let msg: Message;
    try {
      msg = JSON.parse(line) as Message;
    } catch {
      return; // Agents occasionally log to stdout; ignore anything that is not JSON.
    }
    if (msg.method && msg.id !== undefined && msg.id !== null) {
      const id = msg.id;
      this.onRequest(msg.method, msg.params).then(
        (result) => this.safeWrite({ id, result: result ?? null }),
        (e: unknown) => this.safeWrite({ id, error: e instanceof RpcError ? { code: e.code, message: e.message, data: e.data } : { code: -32603, message: (e as Error).message } }),
      );
    } else if (msg.method) {
      this.onNotification(msg.method, msg.params);
    } else if (msg.id !== undefined && msg.id !== null) {
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      if (msg.error) w.reject(new RpcError(msg.error.code, msg.error.message, msg.error.data));
      else w.resolve(msg.result);
    }
  }

  private safeWrite(msg: Message) {
    try {
      this.write(msg);
    } catch {
      /* process gone */
    }
  }
}
