import path from 'node:path';
import { matchesAnyGlob } from '@tutordesk/core';
import { WRITE_TOOLS, type AgentEvent } from './types.js';

/** Raw `claude -p --output-format stream-json` message (only the fields we use). */
interface RawContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

interface RawMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  parent_tool_use_id?: string | null;
  message?: { content?: RawContentBlock[] | string };
  event?: { type?: string; delta?: { type?: string; text?: string } };
  result?: string;
  is_error?: boolean;
  terminal_reason?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  num_turns?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  errors?: string[];
}

function summarize(content: unknown): string | undefined {
  if (typeof content === 'string') return content.slice(0, 200);
  if (Array.isArray(content)) {
    const text = content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .join(' ');
    return text.slice(0, 200) || undefined;
  }
  return undefined;
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  try {
    return JSON.parse(fenced ? fenced[1]! : trimmed);
  } catch {
    return undefined;
  }
}

const RETRYABLE = /overloaded|rate.?limit|timeout|ECONNRESET|503|529|api_error/i;
const AUTH = /authenticat|oauth|log ?in|credential|unauthori[sz]ed|401/i;

export interface MapperOptions {
  /** With --include-partial-messages, text arrives as deltas and full assistant text blocks are skipped. */
  partial: boolean;
  workspaceRoot: string;
  writableGlobs: string[];
  wantStructured: boolean;
}

/**
 * Stateful mapper from Claude Code stream-json lines to provider-neutral AgentEvents.
 * Note: a failed run can still report `subtype: "success"`; `is_error` / `terminal_reason` are authoritative.
 */
export class ClaudeEventMapper {
  sessionId = '';
  sawResult = false;

  constructor(private readonly opts: MapperOptions) {}

  map(line: string): AgentEvent[] {
    let msg: RawMessage;
    try {
      msg = JSON.parse(line) as RawMessage;
    } catch {
      return [];
    }
    if (msg.session_id) this.sessionId = msg.session_id;
    // Subagent traffic is reported through the parent's tool_call; don't double-count it.
    if (msg.parent_tool_use_id) return [];

    switch (msg.type) {
      case 'system':
        return msg.subtype === 'init' ? [{ type: 'init', sessionId: this.sessionId, model: msg.model }] : [];
      case 'stream_event': {
        const d = msg.event?.delta;
        return msg.event?.type === 'content_block_delta' && d?.type === 'text_delta' && d.text
          ? [{ type: 'text_delta', text: d.text }]
          : [];
      }
      case 'assistant':
        return this.mapAssistant(msg);
      case 'user':
        return this.mapUser(msg);
      case 'result':
        return this.mapResult(msg);
      default:
        return [];
    }
  }

  private mapAssistant(msg: RawMessage): AgentEvent[] {
    const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
    const out: AgentEvent[] = [];
    for (const b of blocks) {
      if (b.type === 'text' && b.text && !this.opts.partial) out.push({ type: 'text_delta', text: b.text });
      if (b.type === 'tool_use' && b.id && b.name) {
        out.push({ type: 'tool_call', id: b.id, name: b.name, input: b.input });
        const file = b.input?.file_path ?? b.input?.notebook_path;
        if (WRITE_TOOLS.has(b.name) && typeof file === 'string') {
          const abs = path.resolve(this.opts.workspaceRoot, file);
          const rel = path.relative(this.opts.workspaceRoot, abs);
          const inside = !rel.startsWith('..') && !path.isAbsolute(rel);
          if (!inside || !matchesAnyGlob(rel, this.opts.writableGlobs)) {
            out.push({ type: 'policy_violation', path: inside ? rel.split(path.sep).join('/') : abs, tool: b.name });
          } else {
            out.push({ type: 'file_changed', path: rel.split(path.sep).join('/'), op: b.name === 'Write' ? 'create' : 'edit' });
          }
        }
      }
    }
    return out;
  }

  private mapUser(msg: RawMessage): AgentEvent[] {
    const blocks = Array.isArray(msg.message?.content) ? msg.message.content : [];
    return blocks
      .filter((b) => b.type === 'tool_result' && b.tool_use_id)
      .map((b) => ({ type: 'tool_result', id: b.tool_use_id!, ok: !b.is_error, summary: summarize(b.content) }) as AgentEvent);
  }

  private mapResult(msg: RawMessage): AgentEvent[] {
    this.sawResult = true;
    const out: AgentEvent[] = [];
    const u = msg.usage ?? {};
    out.push({
      type: 'usage',
      inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      usd: msg.total_cost_usd,
    });
    const text = msg.result ?? '';
    const failed =
      msg.is_error === true ||
      (msg.subtype !== undefined && msg.subtype !== 'success') ||
      (msg.terminal_reason !== undefined && /error/i.test(msg.terminal_reason));
    if (failed) {
      const message = text || msg.errors?.join('; ') || msg.subtype || msg.terminal_reason || 'Claude Code run failed';
      out.push({ type: 'error', message, retryable: !AUTH.test(message) && RETRYABLE.test(`${message} ${msg.terminal_reason ?? ''}`), sessionId: this.sessionId });
      return out;
    }
    const structured = msg.structured_output ?? (this.opts.wantStructured ? tryParseJson(text) : undefined);
    out.push({ type: 'done', sessionId: this.sessionId, finalText: text, structured, turns: msg.num_turns });
    return out;
  }
}
