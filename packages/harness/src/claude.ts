import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { query, type CanUseTool, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { which } from '@tutordesk/core';
import { AsyncQueue, BaseSession, GUARDED_DENIAL, splitToolName, type ActionKind } from './session-base.js';
import type { SessionStart, UserTurn } from './types.js';

/** Variables that make a nested CLI think it runs inside another Claude Code session. */
const NESTING_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT'];

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'Skill', 'ToolSearch', 'Task', 'Agent']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'KillBash']);
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch']);

const MEDIA: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function classify(tool: string): ActionKind {
  if (splitToolName(tool).server === 'tutordesk') return 'toolbox';
  if (READ_TOOLS.has(tool)) return 'read';
  if (EDIT_TOOLS.has(tool)) return 'edit';
  if (COMMAND_TOOLS.has(tool)) return 'command';
  if (NETWORK_TOOLS.has(tool)) return 'network';
  return 'other';
}

/** The executable the SDK should run: the user's own install, so their subscription login is used. */
export async function resolveClaudeExecutable(env?: NodeJS.ProcessEnv): Promise<string | undefined> {
  const cmd = await which('claude', env);
  if (!cmd) return undefined;
  // npm shims resolve to `node cli.js`; the SDK runs a .js path with node itself.
  const script = cmd.prefixArgs.find((a) => /\.(c|m)?js$/i.test(a));
  return script ?? cmd.command;
}

function summarise(content: unknown): string | undefined {
  if (typeof content === 'string') return content.slice(0, 400);
  if (Array.isArray(content)) {
    const text = content.map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join(' ');
    return text.slice(0, 400) || undefined;
  }
  return undefined;
}

/**
 * Claude Code through the Agent SDK in streaming-input mode: one long-lived process per thread,
 * each send() a user message, tool permissions answered through canUseTool (appendix E.3.2).
 */
export class ClaudeCodeSession extends BaseSession {
  readonly harness = 'claude-code' as const;
  private input = new AsyncQueue<SDKUserMessage>();
  private q: Query | undefined;
  private abort = new AbortController();
  private interrupted = false;
  private tools = new Map<string, { name: string; input: Record<string, unknown> }>();

  constructor(
    opts: SessionStart,
    private readonly extra: { executable?: string } = {},
  ) {
    super(opts);
  }

  private childEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...process.env, ...this.opts.env })) if (v !== undefined) env[k] = v;
    for (const v of NESTING_VARS) delete env[v];
    // Mode A runs on the tutor's own subscription login, never on a stray API key (SPEC §7.3).
    delete env.ANTHROPIC_API_KEY;
    return env;
  }

  async start(): Promise<void> {
    const mode = this.opts.mode;
    const executable = this.extra.executable ?? (await resolveClaudeExecutable(this.opts.env));
    this.q = query({
      prompt: this.input,
      options: {
        cwd: this.opts.cwd,
        resume: this.opts.resume,
        model: this.opts.model,
        pathToClaudeCodeExecutable: executable,
        env: this.childEnv(),
        abortController: this.abort,
        includePartialMessages: true,
        // Workspace CLAUDE.md and skills only; the tutor's personal settings and plugins stay out.
        settingSources: ['project'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: this.opts.instructions },
        mcpServers: { tutordesk: { type: 'stdio', command: this.opts.mcp.command, args: this.opts.mcp.args, env: this.opts.mcp.env, timeout: 300_000 } },
        allowedTools: ['Read', 'Glob', 'Grep', 'mcp__tutordesk'],
        disallowedTools: mode === 'guarded' ? [...EDIT_TOOLS, ...COMMAND_TOOLS, ...NETWORK_TOOLS] : [...NETWORK_TOOLS],
        permissionMode: mode === 'full' ? 'bypassPermissions' : 'default',
        allowDangerouslySkipPermissions: mode === 'full',
        canUseTool: this.canUseTool,
      },
    });
    void this.pump(this.q);
  }

  private canUseTool: CanUseTool = async (toolName, input) => {
    const kind = classify(toolName);
    if (kind === 'edit' && this.opts.mode === 'collaborate') {
      // Collaborate mode: Markdown in student folders only; structured files go through the tools.
      const file = String(input.file_path ?? input.notebook_path ?? '');
      const rel = path.relative(this.opts.cwd, path.resolve(this.opts.cwd, file)).replace(/\\/g, '/');
      if (!rel.startsWith('students/') || !rel.endsWith('.md')) {
        return { behavior: 'deny', message: 'Only Markdown files inside students/ may be edited directly; use the tutordesk tools for everything else.' };
      }
    }
    const title = kind === 'command' ? `Run: ${String(input.command ?? toolName).slice(0, 200)}` : kind === 'edit' ? `Edit ${String(input.file_path ?? '')}` : `Use ${toolName}`;
    const decision = await this.authorize(kind, title, kind === 'command' ? String(input.description ?? '') || undefined : undefined);
    return decision === 'allow' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: this.opts.mode === 'guarded' ? GUARDED_DENIAL : 'The tutor declined this.' };
  };

  protected async beginTurn(input: UserTurn): Promise<void> {
    if (!this.q) throw new Error('Session not started');
    this.interrupted = false;
    const content: Exclude<SDKUserMessage['message']['content'], string>[number][] = [{ type: 'text', text: input.text }];
    for (const img of input.images ?? []) {
      const media = MEDIA[path.extname(img).toLowerCase()];
      if (!media) throw new Error(`Unsupported image type: ${img}`);
      content.push({ type: 'image', source: { type: 'base64', media_type: media, data: (await readFile(img)).toString('base64') } });
    }
    this.input.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const m of q) this.map(m);
      this.endTurn('failed', 'Claude Code stopped.');
    } catch (e) {
      this.endTurn(this.interrupted ? 'interrupted' : 'failed', (e as Error).message);
    }
  }

  private map(m: SDKMessage): void {
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') {
          this.announce(m.session_id, m.model);
          const td = m.mcp_servers.find((s) => s.name === 'tutordesk');
          if (td && td.status !== 'connected') this.emit({ type: 'notice', level: 'warning', message: `TutorDesk tools are not available (${td.status}).` });
        }
        return;
      case 'stream_event': {
        const ev = m.event;
        if (ev.type === 'content_block_delta') {
          if (ev.delta.type === 'text_delta') this.emit({ type: 'text', delta: ev.delta.text });
          else if (ev.delta.type === 'thinking_delta') this.emit({ type: 'reasoning', delta: ev.delta.thinking });
        }
        return;
      }
      case 'assistant':
        if (m.parent_tool_use_id) return; // a subagent's inner steps
        for (const block of m.message.content) {
          if (block.type !== 'tool_use') continue;
          const input = (block.input ?? {}) as Record<string, unknown>;
          this.tools.set(block.id, { name: block.name, input });
          this.emit({ type: 'tool', id: block.id, ...splitToolName(block.name), input, status: 'running' });
        }
        return;
      case 'user': {
        const content = m.message.content;
        if (typeof content === 'string') return;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const call = this.tools.get(block.tool_use_id);
          this.tools.delete(block.tool_use_id);
          const failed = block.is_error === true;
          this.emit({ type: 'tool', id: block.tool_use_id, ...splitToolName(call?.name ?? 'tool'), status: failed ? 'error' : 'ok', summary: summarise(block.content) });
          const file = call && EDIT_TOOLS.has(call.name) ? String(call.input.file_path ?? '') : '';
          if (file && !failed) this.emit({ type: 'file', path: path.relative(this.opts.cwd, path.resolve(this.opts.cwd, file)).replace(/\\/g, '/'), op: call!.name === 'Write' ? 'create' : 'edit' });
        }
        return;
      }
      case 'result': {
        const u = m.usage;
        this.emit({ type: 'usage', inputTokens: u.input_tokens, outputTokens: u.output_tokens, cachedTokens: u.cache_read_input_tokens ?? undefined, usd: m.total_cost_usd });
        if (this.interrupted) this.endTurn('interrupted');
        else if (m.subtype === 'success' && !m.is_error) this.endTurn('completed');
        else this.endTurn('failed', m.subtype === 'success' ? m.result : m.errors.join('; ') || m.subtype);
        return;
      }
      default:
        return;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.busy || !this.q) return;
    this.interrupted = true;
    await this.q.interrupt();
  }

  async close(): Promise<void> {
    this.input.end();
    this.abort.abort();
    this.endTurn('interrupted');
  }
}
