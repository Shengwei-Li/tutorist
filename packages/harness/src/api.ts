import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet, type UserContent } from 'ai';
import { z } from 'zod';
import { readJson, resolveInside, writeFileAtomic, writeJson } from '@tutordesk/core';
import { workspaceReadTools } from '@tutordesk/providers';
import type { Toolbox } from '@tutordesk/toolbox';
import { BaseSession } from './session-base.js';
import type { SessionStart, UserTurn } from './types.js';

const MEDIA: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

const StoredSession = z.object({ model: z.string(), messages: z.array(z.any()) });

export interface ApiSessionDeps {
  model: LanguageModel;
  /** Shown in the UI and recorded in git messages, e.g. "openrouter:google/gemini-3.8-flash". */
  modelLabel: string;
  /** The teaching tools, called in-process (no MCP needed). */
  toolbox: Pick<Toolbox, 'definitions' | 'call'>;
  /** apiSystemPrompt() from @tutordesk/toolbox. */
  system: string;
  /** Upper bound on model calls in one turn; a full lesson takes about 20. */
  maxSteps?: number;
}

/**
 * Chat with a model reached by API key (appendix E.3.2, H6): our own small agent loop over the same
 * tutordesk tools, for tutors who do not use a coding agent. The conversation lives in
 * <workspace>/.tutordesk/api-sessions/<id>.json so a thread can be resumed after a restart.
 */
export class ApiSession extends BaseSession {
  readonly harness = 'api' as const;
  private messages: ModelMessage[] = [];
  private abort: AbortController | null = null;
  private failedCalls = new Set<string>();
  private toolboxNames: Set<string>;

  constructor(
    opts: SessionStart,
    private readonly deps: ApiSessionDeps,
  ) {
    super(opts);
    this.model = deps.modelLabel;
    this.toolboxNames = new Set(deps.toolbox.definitions().map((d) => d.name));
  }

  private file(id: string): string {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Bad session id ${id}`);
    return path.join(this.opts.cwd, '.tutordesk', 'api-sessions', `${id}.json`);
  }

  async start(): Promise<void> {
    if (this.opts.resume) {
      const r = await readJson(this.file(this.opts.resume), StoredSession);
      if (!r.ok) throw new Error(`Cannot resume this conversation: ${r.issues[0] ?? 'not found'}`);
      this.messages = r.value.messages as ModelMessage[];
      this.nativeId = this.opts.resume;
    } else {
      this.nativeId = randomUUID();
    }
  }

  private tools(): ToolSet {
    const tools: ToolSet = { ...workspaceReadTools(this.opts.cwd) };
    for (const def of this.deps.toolbox.definitions()) {
      tools[def.name] = tool({
        description: def.description,
        inputSchema: z.object(def.input),
        execute: async (args: unknown, { toolCallId }: { toolCallId: string }) => {
          const r = await this.deps.toolbox.call(def.name, args);
          if (r.isError) this.failedCalls.add(toolCallId);
          return r.text;
        },
      });
    }
    if (this.opts.mode !== 'guarded') {
      tools.write_markdown = tool({
        description: 'Create or replace a Markdown file inside students/ (notes, plans in prose). Structured lesson files go through the TutorDesk tools instead.',
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path: p, content }: { path: string; content: string }, { toolCallId }: { toolCallId: string }) => {
          const rel = p.replace(/\\/g, '/');
          if (!rel.startsWith('students/') || !rel.endsWith('.md')) {
            this.failedCalls.add(toolCallId);
            return 'Refused: only Markdown files inside students/ can be written.';
          }
          if ((await this.authorize('edit', `Write ${rel}`)) === 'deny') {
            this.failedCalls.add(toolCallId);
            return 'The tutor declined this change.';
          }
          const abs = await resolveInside(this.opts.cwd, rel);
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFileAtomic(abs, content);
          this.emit({ type: 'file', path: rel, op: 'edit' });
          return `Wrote ${rel}`;
        },
      });
    }
    return tools;
  }

  protected async beginTurn(input: UserTurn): Promise<void> {
    const content: Exclude<UserContent, string> = [{ type: 'text', text: input.text }];
    for (const img of input.images ?? []) {
      const mediaType = MEDIA[path.extname(img).toLowerCase()];
      if (!mediaType) throw new Error(`Unsupported image type: ${img}`);
      content.push({ type: 'image', image: await readFile(img), mediaType });
    }
    const userMessage: ModelMessage = { role: 'user', content };
    const abort = new AbortController();
    this.abort = abort;
    this.failedCalls.clear();
    const system = [this.deps.system, this.opts.instructions].filter(Boolean).join('\n\n');
    let error: string | undefined;
    let usd = 0;

    const result = streamText({
      model: this.deps.model,
      system,
      messages: [...this.messages, userMessage],
      tools: this.tools(),
      stopWhen: stepCountIs(this.deps.maxSteps ?? 40),
      abortSignal: abort.signal,
    });
    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta':
            this.emit({ type: 'text', delta: part.text });
            break;
          case 'reasoning-delta':
            this.emit({ type: 'reasoning', delta: part.text });
            break;
          case 'tool-call':
            this.emit({ type: 'tool', id: part.toolCallId, server: this.serverOf(part.toolName), name: part.toolName, input: part.input, status: 'running' });
            break;
          case 'tool-result':
            this.emit({ type: 'tool', id: part.toolCallId, server: this.serverOf(part.toolName), name: part.toolName, status: this.failedCalls.has(part.toolCallId) ? 'error' : 'ok', summary: String(part.output).slice(0, 400) });
            break;
          case 'tool-error':
            this.emit({ type: 'tool', id: part.toolCallId, server: this.serverOf(part.toolName), name: part.toolName, status: 'error', summary: String((part.error as Error)?.message ?? part.error).slice(0, 400) });
            break;
          case 'finish-step': {
            // OpenRouter reports the exact charge per call.
            const cost = (part.providerMetadata?.openrouter as { usage?: { cost?: number } } | undefined)?.usage?.cost;
            if (typeof cost === 'number') usd += cost;
            break;
          }
          case 'finish': {
            const u = part.totalUsage;
            this.emit({ type: 'usage', inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, cachedTokens: u.inputTokenDetails.cacheReadTokens, usd: usd || undefined });
            break;
          }
          case 'error':
            error = (part.error as Error)?.message ?? String(part.error);
            break;
          default:
            break;
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) error = (e as Error).message;
    } finally {
      this.abort = null;
    }

    if (abort.signal.aborted) {
      // Keep the question so the conversation still reads correctly; drop the half answer.
      this.messages.push(userMessage);
      await this.save();
      this.endTurn('interrupted');
      return;
    }
    if (error) {
      this.endTurn('failed', error);
      return;
    }
    this.messages.push(userMessage, ...((await result.responseMessages) as ModelMessage[]));
    await this.save();
    this.endTurn('completed');
  }

  private serverOf(name: string): string | undefined {
    return this.toolboxNames.has(name) ? 'tutordesk' : undefined;
  }

  private async save(): Promise<void> {
    if (!this.nativeId) return;
    const file = this.file(this.nativeId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeJson(file, { model: this.deps.modelLabel, messages: this.messages });
  }

  async interrupt(): Promise<void> {
    this.abort?.abort();
  }

  async close(): Promise<void> {
    this.abort?.abort();
    this.endTurn('interrupted');
  }
}

