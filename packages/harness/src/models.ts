import { spawn } from 'node:child_process';
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { execText, which, type ResolvedCommand } from '@tutordesk/core';
import { claudeEnv, resolveClaudeExecutable } from './claude.js';
import { JsonRpcPeer } from './jsonrpc.js';
import { agentEnv, stopProcess } from './session-base.js';
import type { CliHarnessId, ModelChoice, ModelList } from './types.js';

export interface ListModelsOptions {
  /** The workspace: agents read their project config from here. */
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Tests run a stand-in agent. */
  executable?: ResolvedCommand;
  timeoutMs?: number;
}

/**
 * The models the agent offers the tutor's own account, asked of the agent itself so the list follows
 * its updates and the tutor's plan. Nothing is sent to a model, so asking costs nothing.
 */
export async function listModels(harness: CliHarnessId, o: ListModelsOptions): Promise<ModelList> {
  const timeoutMs = o.timeoutMs ?? 45_000;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The agent took too long to list its models.')), timeoutMs);
  });
  try {
    const ask = harness === 'claude-code' ? claudeModels(o) : harness === 'codex' ? codexModels(o) : opencodeModels(o);
    return await Promise.race([ask, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Claude Code reports its models during the SDK handshake, before any prompt. */
async function claudeModels(o: ListModelsOptions): Promise<ModelList> {
  const abort = new AbortController();
  const never: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
  try {
    const q = query({
      prompt: never,
      options: { cwd: o.cwd, env: claudeEnv(o.env), abortController: abort, settingSources: [], pathToClaudeCodeExecutable: await resolveClaudeExecutable(o.env) },
    });
    const rows = await q.supportedModels();
    // The "default" row stands for whichever model the account defaults to; the picker has its own.
    const def = rows.find((r) => r.value === 'default');
    const models = rows.filter((r) => r.value !== 'default').map((r) => ({ id: r.value, label: r.displayName, description: r.description || undefined }));
    const defaultLabel = def && rows.find((r) => r !== def && r.resolvedModel && r.resolvedModel === def.resolvedModel)?.displayName;
    return { models, defaultLabel };
  } finally {
    abort.abort();
  }
}

interface CodexModel {
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
}

/** Codex answers `model/list` on its app-server. */
async function codexModels(o: ListModelsOptions): Promise<ModelList> {
  const exe = o.executable ?? (await which('codex', o.env));
  if (!exe) throw new Error('Codex is not installed.');
  const child = spawn(exe.command, [...exe.prefixArgs, 'app-server'], { cwd: o.cwd, env: agentEnv(o.env), windowsHide: true });
  try {
    const peer = new JsonRpcPeer(child, { header: false });
    await peer.request('initialize', { clientInfo: { name: 'tutordesk', title: 'TutorDesk', version: '0.1.0' }, capabilities: null });
    peer.notify('initialized');
    const all: CodexModel[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const r: { data: CodexModel[]; nextCursor: string | null } = await peer.request('model/list', { cursor });
      all.push(...r.data);
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    const shown = all.filter((m) => !m.hidden);
    return {
      models: shown.map((m) => ({ id: m.model, label: m.displayName, description: m.description || undefined })),
      defaultLabel: all.find((m) => m.isDefault)?.displayName,
    };
  } finally {
    await stopProcess(child);
  }
}

/**
 * `opencode models` prints the provider/model ids the tutor has set up, the same ids its ACP model
 * option takes. (Asking over ACP would need a session, which OpenCode then keeps in its history.)
 */
async function opencodeModels(o: ListModelsOptions): Promise<ModelList> {
  const exe = o.executable ?? (await which('opencode', o.env));
  if (!exe) throw new Error('OpenCode is not installed.');
  const r = await execText(exe, ['models'], { cwd: o.cwd, env: agentEnv(o.env), timeoutMs: o.timeoutMs ?? 45_000 });
  if (r.code !== 0) throw new Error(r.stderr.trim().split(/\r?\n/).at(-1) || 'OpenCode could not list its models.');
  const models: ModelChoice[] = r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+\/\S+$/.test(l))
    .map((id) => ({ id, label: id }));
  return { models };
}
