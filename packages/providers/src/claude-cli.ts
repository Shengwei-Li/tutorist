import { spawn } from 'node:child_process';
import { ClaudeEventMapper } from './claude-events.js';
import { execText, killTree, LineSplitter, which, type ResolvedCommand } from '@tutordesk/core';
import { DEFAULT_TOOLS, type AgentEvent, type AgentProvider, type AgentRunSpec, type HealthStatus, type ModelTier, type ProviderCapabilities } from './types.js';

export interface ClaudeCliOptions {
  /** Override the executable (tests, or a user-configured path). */
  executable?: ResolvedCommand;
  /**
   * 'subscription' strips ANTHROPIC_API_KEY so the CLI uses the user's own login (mode A, SPEC §7.3).
   * 'inherit' leaves the environment untouched.
   */
  auth?: 'subscription' | 'inherit';
  /** Stream text as deltas. */
  partialMessages?: boolean;
  env?: NodeJS.ProcessEnv;
}

const CLAUDE_TIERS: Record<ModelTier, string> = { quality: 'opus', balanced: 'sonnet', fast: 'haiku' };

/** Claude Code reads attachments itself with its Read tool, so we name them in the prompt. */
function withAttachments(spec: AgentRunSpec): { prompt: string; tools: string[] } {
  const tools = spec.tools ?? DEFAULT_TOOLS[spec.taskType];
  if (!spec.attachments?.length) return { prompt: spec.prompt, tools };
  const list = spec.attachments.map((a) => `- ${a.path}`).join('\n');
  return {
    prompt: `${spec.prompt}\n\nAttached files (open each with the Read tool before answering):\n${list}`,
    tools: tools.includes('Read') ? tools : [...tools, 'Read'],
  };
}

/** Variables that make a nested CLI think it runs inside another Claude Code session. */
const NESTING_VARS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT'];

export class ClaudeCliProvider implements AgentProvider {
  readonly id = 'claude-cli' as const;
  private exe: Promise<ResolvedCommand | null> | undefined;

  constructor(private readonly opts: ClaudeCliOptions = {}) {}

  private executable(): Promise<ResolvedCommand | null> {
    this.exe ??= this.opts.executable ? Promise.resolve(this.opts.executable) : which('claude', this.opts.env);
    return this.exe;
  }

  childEnv(): NodeJS.ProcessEnv {
    const env = { ...(this.opts.env ?? process.env) };
    for (const v of NESTING_VARS) delete env[v];
    if ((this.opts.auth ?? 'subscription') === 'subscription') delete env.ANTHROPIC_API_KEY;
    return env;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return { structuredOutput: true, subagents: true, skills: true, resume: true, authModes: ['subscription', 'apiKey'] };
  }

  async healthCheck(): Promise<HealthStatus> {
    const exe = await this.executable();
    if (!exe) {
      return { ok: false, installed: false, authed: false, detail: 'Claude Code is not installed. Install it, then sign in with `claude auth login`.' };
    }
    const env = this.childEnv();
    const ver = await execText(exe, ['--version'], { env, timeoutMs: 20_000 });
    const version = /\d+\.\d+\.\d+/.exec(ver.stdout)?.[0];
    const status = await execText(exe, ['auth', 'status'], { env, timeoutMs: 20_000 });
    let authed = false;
    let authMethod: string | undefined;
    try {
      const j = JSON.parse(status.stdout) as { loggedIn?: boolean; authMethod?: string };
      authed = j.loggedIn === true;
      authMethod = j.authMethod;
    } catch {
      /* older CLIs print text; fall through as unknown */
    }
    return {
      ok: ver.code === 0 && authed,
      installed: ver.code === 0,
      version,
      authed,
      authMethod,
      executable: exe.command,
      detail: authed ? undefined : 'Claude Code is installed but not signed in. Run `claude auth login` in a terminal.',
    };
  }

  /** Build CLI arguments for a run. The prompt itself goes through stdin (no argv length limits). */
  buildArgs(spec: AgentRunSpec): string[] {
    const partial = this.opts.partialMessages ?? true;
    const { tools } = withAttachments(spec);
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-prompts', 'none'];
    if (partial) args.push('--include-partial-messages');
    // Project settings only: the teacher's global ~/.claude config must not leak into lesson generation.
    args.push('--setting-sources', 'project');
    args.push('--tools', tools.join(','));
    if (!spec.permissions.allowShell) args.push('--restricted');
    if (tools.some((t) => t === 'Write' || t === 'Edit')) args.push('--permission-mode', 'acceptEdits');
    if (spec.systemAppend) args.push('--append-system-prompt', spec.systemAppend);
    if (spec.outputSchema) args.push('--json-schema', JSON.stringify(spec.outputSchema));
    if (spec.model) args.push('--model', CLAUDE_TIERS[spec.model as ModelTier] ?? spec.model);
    if (spec.effort) args.push('--effort', spec.effort);
    if (spec.budget?.maxUsd !== undefined) args.push('--max-budget-usd', String(spec.budget.maxUsd));
    if (spec.resumeSessionId) args.push('--resume', spec.resumeSessionId);
    return args;
  }

  async *run(spec: AgentRunSpec, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const exe = await this.executable();
    if (!exe) {
      yield { type: 'error', message: 'Claude Code is not installed.', retryable: false };
      return;
    }
    const mapper = new ClaudeEventMapper({
      partial: this.opts.partialMessages ?? true,
      workspaceRoot: spec.workspaceRoot,
      writableGlobs: spec.permissions.writableGlobs,
      wantStructured: spec.outputSchema !== undefined,
    });

    const child = spawn(exe.command, [...exe.prefixArgs, ...this.buildArgs(spec)], {
      cwd: spec.workspaceRoot,
      env: this.childEnv(),
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const queue: AgentEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    let stderr = '';
    let exitCode: number | null = null;
    const notify = () => {
      wake?.();
      wake = undefined;
    };
    const splitter = new LineSplitter();
    const turnLimit = spec.budget?.maxTurns;
    let turns = 0;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of splitter.push(chunk)) {
        for (const ev of mapper.map(line)) {
          if (ev.type === 'tool_call' && turnLimit !== undefined && ++turns > turnLimit) {
            queue.push({ type: 'error', message: `Stopped: more than ${turnLimit} tool calls`, retryable: false, sessionId: mapper.sessionId });
            killTree(child);
          }
          queue.push(ev);
        }
      }
      notify();
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => {
      stderr = (stderr + c).slice(-4000);
    });
    child.on('error', (e) => {
      queue.push({ type: 'error', message: `Could not start Claude Code: ${e.message}`, retryable: false });
      finished = true;
      notify();
    });
    child.on('close', (code) => {
      exitCode = code;
      for (const line of splitter.flush()) queue.push(...mapper.map(line));
      finished = true;
      notify();
    });

    const onAbort = () => killTree(child);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdin.end(withAttachments(spec).prompt, 'utf8');

    try {
      for (;;) {
        while (queue.length) yield queue.shift()!;
        if (finished) break;
        await new Promise<void>((r) => (wake = r));
      }
      if (signal?.aborted) {
        yield { type: 'error', message: 'Cancelled', retryable: false, sessionId: mapper.sessionId };
      } else if (!mapper.sawResult) {
        const tail = stderr.trim().split('\n').slice(-3).join(' ');
        yield { type: 'error', message: `Claude Code exited (code ${exitCode}) without a result. ${tail}`.trim(), retryable: true, sessionId: mapper.sessionId };
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      killTree(child);
    }
  }
}
