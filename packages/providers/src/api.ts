import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { APICallError, generateText, jsonSchema, Output, stepCountIs, tool, type LanguageModel, type ModelMessage, type ToolSet, type UserContent } from 'ai';
import { z } from 'zod';
import { matchesAnyGlob, resolveInside, toPosixRelative } from '@tutordesk/core';
import { DEFAULT_TOOLS, type AgentEvent, type AgentProvider, type AgentRunSpec, type HealthStatus, type ModelTier, type ProviderCapabilities } from './types.js';

export const API_GATEWAYS = ['openrouter', 'anthropic', 'openai', 'openai-compatible'] as const;
export type ApiGateway = (typeof API_GATEWAYS)[number];

export interface ApiConfig {
  gateway: ApiGateway;
  apiKey: string;
  /** Required for openai-compatible; optional override for the others. */
  baseURL?: string;
  models: Record<ModelTier, string>;
}

/**
 * Default model per tier and gateway (SPEC §7.7, "quality first" preset). Model ids change often;
 * teachers can override every tier in Settings.
 */
export const DEFAULT_MODELS: Record<ApiGateway, Record<ModelTier, string>> = {
  // Cost-first preset (checked on OpenRouter 2026-10-26): a strong writer for materials and a
  // different model family as reviewer, which reduces self-grading bias; both read images.
  openrouter: { quality: 'google/gemini-3.8-flash', balanced: 'deepseek/deepseek-v4.1-flash', fast: 'deepseek/deepseek-v4.1-flash' },
  anthropic: { quality: 'claude-opus-5-5', balanced: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' },
  openai: { quality: 'gpt-6.1-sol', balanced: 'gpt-6-astra', fast: 'gpt-6-luna' },
  'openai-compatible': { quality: '', balanced: '', fast: '' },
};

const KEY_CHECK: Record<Exclude<ApiGateway, 'openai-compatible'>, { url: string; headers: (k: string) => Record<string, string> }> = {
  openrouter: { url: 'https://openrouter.ai/api/v1/key', headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  anthropic: { url: 'https://api.anthropic.com/v1/models?limit=1', headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }) },
  openai: { url: 'https://api.openai.com/v1/models', headers: (k) => ({ Authorization: `Bearer ${k}` }) },
};

export function createLanguageModel(cfg: ApiConfig, modelId: string): LanguageModel {
  switch (cfg.gateway) {
    case 'openrouter':
      return createOpenRouter({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, appName: 'TutorDesk' } as Parameters<typeof createOpenRouter>[0]).chat(modelId);
    case 'anthropic':
      return createAnthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })(modelId);
    case 'openai':
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })(modelId);
    case 'openai-compatible':
      if (!cfg.baseURL) throw new Error('An OpenAI-compatible endpoint needs a base URL');
      return createOpenAICompatible({ name: 'custom', apiKey: cfg.apiKey, baseURL: cfg.baseURL, supportsStructuredOutputs: true })(modelId);
  }
}

const SYSTEM = `You work inside a private English tutor's lesson-preparation tool (IELTS and PTE).
Follow the task instructions exactly. When a JSON schema is given, answer with JSON that satisfies it and nothing else.
Refer to students by name or with they/them. Never invent exam rules; use only the facts given to you.`;

function tryParseJson(text: string): unknown {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  const body = fenced ? fenced[1]! : t.slice(Math.max(0, t.indexOf('{')), t.lastIndexOf('}') + 1);
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Tool failures go back to the model as text so it can recover, instead of aborting the run. */
function safe<I>(fn: (input: I) => Promise<string>): (input: I) => Promise<string> {
  return async (input) => {
    try {
      return await fn(input);
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  };
}

/** Read-only, path-jailed workspace tools: read_file, list_dir, search_text (shared with chat sessions). */
export function workspaceReadTools(root: string): ToolSet {
  const tools: ToolSet = {};
  tools.read_file = tool({
    description: 'Read a UTF-8 text file inside the working folder. Path is relative to that folder.',
    inputSchema: z.object({ path: z.string() }),
    execute: safe(async ({ path: p }: { path: string }) => {
      const abs = await resolveInside(root, p);
      const text = await readFile(abs, 'utf8');
      return text.length > 60_000 ? `${text.slice(0, 60_000)}\n…[truncated]` : text;
    }),
  });
  tools.list_dir = tool({
    description: 'List files and folders inside the working folder.',
    inputSchema: z.object({ path: z.string().default('.') }),
    execute: safe(async ({ path: p }: { path: string }) => {
      const abs = await resolveInside(root, p);
      const names = await readdir(abs);
      const rows = await Promise.all(names.filter((n) => !n.startsWith('.')).map(async (n) => ((await stat(path.join(abs, n))).isDirectory() ? `${n}/` : n)));
      return rows.join('\n');
    }),
  });
  tools.search_text = tool({
    description: 'Search text files under a folder for a case-insensitive substring; returns path:line: text.',
    inputSchema: z.object({ query: z.string().min(2), path: z.string().default('.') }),
    execute: safe(async ({ query, path: p }: { query: string; path: string }) => {
      const start = await resolveInside(root, p);
      const hits: string[] = [];
      const walk = async (dir: string): Promise<void> => {
        for (const n of await readdir(dir)) {
          if (n.startsWith('.') || hits.length >= 50) continue;
          const abs = path.join(dir, n);
          if ((await stat(abs)).isDirectory()) await walk(abs);
          else if (/\.(md|txt|json|jsonl|tex)$/i.test(n)) {
            const lines = (await readFile(abs, 'utf8')).split(/\r?\n/);
            lines.forEach((l, i) => {
              if (hits.length < 50 && l.toLowerCase().includes(query.toLowerCase())) hits.push(`${toPosixRelative(root, abs)}:${i + 1}: ${l.slice(0, 200)}`);
            });
          }
        }
      };
      await walk(start);
      return hits.join('\n') || 'No matches.';
    }),
  });
  return tools;
}

/** Path-jailed tools for open-ended tasks; writes are limited to the spec's writable globs (SPEC §7.8). */
function buildTools(spec: AgentRunSpec, emit: (e: AgentEvent) => void): ToolSet {
  const enabled = new Set(spec.tools ?? DEFAULT_TOOLS[spec.taskType]);
  const root = spec.workspaceRoot;
  const read = workspaceReadTools(root);
  const tools: ToolSet = {};
  if (enabled.has('Read')) tools.read_file = read.read_file!;
  if (enabled.has('Glob')) tools.list_dir = read.list_dir!;
  if (enabled.has('Grep')) tools.search_text = read.search_text!;
  if (enabled.has('Write')) {
    tools.write_file = tool({
      description: 'Create or overwrite a UTF-8 file. Only paths the task allows can be written.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: safe(async ({ path: p, content }: { path: string; content: string }) => {
        const abs = await resolveInside(root, p);
        const rel = toPosixRelative(root, abs);
        if (!matchesAnyGlob(rel, spec.permissions.writableGlobs)) {
          emit({ type: 'policy_violation', path: rel, tool: 'write_file' });
          return `Refused: ${rel} is outside the writable area.`;
        }
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
        emit({ type: 'file_changed', path: rel, op: 'create' });
        return `Wrote ${rel}`;
      }),
    });
  }
  return tools;
}

/** A 400 saying the schema itself is too complex or unsupported (not a problem with the content). */
export function isSchemaRejection(e: unknown): boolean {
  if (!APICallError.isInstance(e) || e.statusCode !== 400) return false;
  const text = `${e.message} ${typeof e.responseBody === 'string' ? e.responseBody : ''}`;
  return /grammar|union|schema|too (large|complex|many)|invalid argument|response_format/i.test(text);
}

function errorEvent(e: unknown, sessionId: string): AgentEvent {
  if (APICallError.isInstance(e)) {
    const auth = e.statusCode === 401 || e.statusCode === 403;
    const message = auth ? `The API key was rejected (${e.statusCode}). Check it in Settings.` : `${e.statusCode ?? ''} ${e.message}`.trim();
    return { type: 'error', message, retryable: !auth && (e.isRetryable || (e.statusCode ?? 0) >= 500 || e.statusCode === 429), sessionId };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { type: 'error', message: msg, retryable: /timeout|ECONNRESET|fetch failed/i.test(msg), sessionId };
}

export interface ApiProviderOptions {
  /** Inject a model (tests) instead of creating one from the config. */
  modelFactory?: (modelId: string) => LanguageModel;
  fetch?: typeof fetch;
}

/** Mode B (SPEC §7.2): our own light harness over the Vercel AI SDK, with the teacher's own key. */
export class ApiProvider implements AgentProvider {
  readonly id = 'api' as const;
  /** Conversation history per session so runStructured can ask for repairs. */
  private sessions = new Map<string, ModelMessage[]>();
  /** Models whose provider rejected a strict schema; they get JSON mode from then on (process-wide). */
  static jsonModeModels = new Set<string>();

  constructor(
    private readonly cfg: ApiConfig,
    private readonly opts: ApiProviderOptions = {},
  ) {}

  async capabilities(): Promise<ProviderCapabilities> {
    return { structuredOutput: true, subagents: false, skills: false, resume: true, authModes: ['apiKey'] };
  }

  resolveModelId(model: AgentRunSpec['model']): string {
    const tier = (model ?? 'quality') as ModelTier;
    return this.cfg.models[tier] || (model as string) || this.cfg.models.quality;
  }

  /** Verify the key with a free endpoint; never spends tokens. */
  async healthCheck(): Promise<HealthStatus> {
    if (!this.cfg.apiKey) return { ok: false, installed: true, authed: false, detail: 'No API key yet.' };
    if (!this.cfg.models.quality) return { ok: false, installed: true, authed: false, detail: 'Choose a model for each tier.' };
    const doFetch = this.opts.fetch ?? fetch;
    const check =
      this.cfg.gateway === 'openai-compatible'
        ? this.cfg.baseURL
          ? { url: `${this.cfg.baseURL.replace(/\/$/, '')}/models`, headers: { Authorization: `Bearer ${this.cfg.apiKey}` } }
          : null
        : { url: KEY_CHECK[this.cfg.gateway].url, headers: KEY_CHECK[this.cfg.gateway].headers(this.cfg.apiKey) };
    if (!check) return { ok: false, installed: true, authed: false, detail: 'Enter the base URL of your endpoint.' };
    try {
      const res = await doFetch(check.url, { headers: check.headers, signal: AbortSignal.timeout(15_000) });
      if (res.status === 401 || res.status === 403) return { ok: false, installed: true, authed: false, authMethod: this.cfg.gateway, detail: 'The API key was rejected.' };
      if (!res.ok) return { ok: false, installed: true, authed: false, authMethod: this.cfg.gateway, detail: `The service answered ${res.status}.` };
      return { ok: true, installed: true, authed: true, authMethod: this.cfg.gateway, version: this.cfg.models.quality };
    } catch (e) {
      return { ok: false, installed: true, authed: false, authMethod: this.cfg.gateway, detail: `Could not reach the service: ${(e as Error).message}` };
    }
  }

  private async userMessage(spec: AgentRunSpec): Promise<ModelMessage> {
    if (!spec.attachments?.length) return { role: 'user', content: spec.prompt };
    const parts: Exclude<UserContent, string> = [{ type: 'text', text: spec.prompt }];
    for (const a of spec.attachments) {
      const data = await readFile(await resolveInside(spec.workspaceRoot, a.path));
      parts.push({ type: 'file', data, mediaType: a.mediaType });
    }
    return { role: 'user', content: parts };
  }

  async *run(spec: AgentRunSpec, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const sessionId = spec.resumeSessionId && this.sessions.has(spec.resumeSessionId) ? spec.resumeSessionId : randomUUID();
    const modelId = this.resolveModelId(spec.model);
    yield { type: 'init', sessionId, model: modelId };

    const queued: AgentEvent[] = [];
    const emit = (e: AgentEvent) => queued.push(e);
    const history = [...(this.sessions.get(sessionId) ?? []), await this.userMessage(spec)];
    const tools = buildTools(spec, emit);
    const hasTools = Object.keys(tools).length > 0;

    const system = spec.systemAppend ? `${SYSTEM}\n\n${spec.systemAppend}` : SYSTEM;
    const call = (jsonMode: boolean) =>
      generateText({
        model: this.opts.modelFactory ? this.opts.modelFactory(modelId) : createLanguageModel(this.cfg, modelId),
        system: jsonMode && spec.outputSchema ? `${system}\n\nAnswer with one JSON object that conforms to this JSON Schema. No prose and no code fences.\n${JSON.stringify(spec.outputSchema)}` : system,
        messages: history,
        ...(hasTools ? { tools, stopWhen: stepCountIs(spec.budget?.maxTurns ?? 12) } : {}),
        ...(spec.outputSchema ? { output: jsonMode ? Output.json() : Output.object({ schema: jsonSchema(spec.outputSchema) }) } : {}),
        abortSignal: signal,
        maxRetries: 2,
        onStepFinish: (step) => {
          for (const c of step.toolCalls) emit({ type: 'tool_call', id: c.toolCallId, name: c.toolName, input: c.input });
          for (const r of step.toolResults) {
            const out = String(r.output);
            emit({ type: 'tool_result', id: r.toolCallId, ok: !/^(Error|Refused):/.test(out), summary: out.slice(0, 200) });
          }
        },
      });

    try {
      let result: Awaited<ReturnType<typeof call>>;
      const jsonMode = spec.outputSchema !== undefined && ApiProvider.jsonModeModels.has(modelId);
      try {
        result = await call(jsonMode);
      } catch (e) {
        // Some providers cap strict-schema complexity (Anthropic: 16 union fields, grammar size). Such a
        // rejection costs nothing; retry in JSON mode, where our own validation stays just as strict.
        if (!spec.outputSchema || jsonMode || !isSchemaRejection(e)) throw e;
        ApiProvider.jsonModeModels.add(modelId);
        result = await call(true);
      }
      for (const e of queued.splice(0)) yield e;

      let structured: unknown;
      if (spec.outputSchema) {
        try {
          structured = result.output;
        } catch {
          structured = tryParseJson(result.text);
        }
      }
      this.sessions.set(sessionId, [...history, ...result.responseMessages]);
      const u = result.totalUsage;
      const cost = (result.providerMetadata?.openrouter as { usage?: { cost?: number } } | undefined)?.usage?.cost;
      yield {
        type: 'usage',
        inputTokens: u.inputTokens ?? 0,
        outputTokens: u.outputTokens ?? 0,
        cacheRead: u.inputTokenDetails?.cacheReadTokens ?? 0,
        usd: cost,
      };
      if (result.text && !spec.outputSchema) yield { type: 'text_delta', text: result.text };
      yield { type: 'done', sessionId, finalText: result.text, structured, turns: result.steps.length };
    } catch (e) {
      for (const ev of queued.splice(0)) yield ev;
      if (signal?.aborted) {
        yield { type: 'error', message: 'Cancelled', retryable: false, sessionId };
        return;
      }
      // Output that fails the schema still comes back as text: hand it to runStructured for repair.
      const text = (e as { text?: string }).text;
      if (spec.outputSchema && typeof text === 'string' && text.length > 0) {
        this.sessions.set(sessionId, [...history, { role: 'assistant', content: text }]);
        yield { type: 'done', sessionId, finalText: text, structured: tryParseJson(text) };
        return;
      }
      yield errorEvent(e, sessionId);
    }
  }
}
