import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ClaudeCliProvider, LineSplitter, parseCmdShim, runStructured, type AgentEvent, type AgentRunSpec } from '../src/index.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-prov-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function provider(scenario: string, extraEnv: Record<string, string> = {}) {
  return new ClaudeCliProvider({
    executable: { command: process.execPath, prefixArgs: [FAKE] },
    env: { ...process.env, FAKE_SCENARIO: scenario, ...extraEnv },
  });
}

function spec(overrides: Partial<AgentRunSpec> = {}): AgentRunSpec {
  return {
    taskType: 'generate',
    workspaceRoot: tmp,
    prompt: 'Make a plan',
    permissions: { writableGlobs: ['lessons/2026-10-26-L04/**'], readableGlobs: ['**'], allowShell: false, allowNetwork: false },
    ...overrides,
  };
}

async function collect(it: AsyncIterable<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const Band = z.object({ label: z.string(), confidence: z.number().min(0).max(1) });

describe('ClaudeCliProvider', () => {
  it('maps a successful run: deltas, tool calls, file changes, policy violations, usage, structured result', async () => {
    const events = await collect(provider('success').run(spec({ outputSchema: { type: 'object' } })));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('init');
    expect(events.filter((e) => e.type === 'text_delta').map((e) => (e as { text: string }).text).join('')).toBe('Planning…');
    expect(events).toContainEqual({ type: 'file_changed', path: 'lessons/2026-10-26-L04/plan.json', op: 'create' });
    expect(events).toContainEqual({ type: 'policy_violation', path: 'profile.json', tool: 'Edit' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', id: 't1', ok: true }));
    expect(events).toContainEqual({ type: 'usage', inputTokens: 10, outputTokens: 5, cacheRead: 100, usd: 0.0123 });
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', sessionId: 'sess-1', structured: { label: 'Band 6.5', confidence: 0.8 } });
    expect(JSON.stringify(events)).not.toContain('subagent noise');
  });

  it('treats is_error results as failures even when subtype is "success"', async () => {
    const events = await collect(provider('auth-fail').run(spec()));
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'error', retryable: false });
    expect((last as { message: string }).message).toMatch(/OAuth session expired/);
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('reports a crash without result as a retryable error with stderr', async () => {
    const last = (await collect(provider('crash').run(spec()))).at(-1);
    expect(last).toMatchObject({ type: 'error', retryable: true });
    expect((last as { message: string }).message).toMatch(/code 3.*something broke/);
  });

  it('cancels a hung run via AbortSignal', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const started = Date.now();
    const last = (await collect(provider('hang').run(spec(), ac.signal))).at(-1);
    expect(last).toMatchObject({ type: 'error', message: 'Cancelled' });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('passes the prompt through stdin and builds sandboxed arguments', async () => {
    const rec = path.join(tmp, 'rec.jsonl');
    await collect(provider('success', { FAKE_RECORD: rec }).run(spec({ systemAppend: 'Be brief', outputSchema: { type: 'object' }, model: 'opus', effort: 'low' })));
    const [call] = (await readFile(rec, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; stdin: string });
    expect(call!.stdin).toBe('Make a plan');
    const a = call!.args;
    expect(a).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--restricted', '--permission-prompts', 'none']));
    expect(a[a.indexOf('--tools') + 1]).toBe('Read,Write,Edit,Glob,Grep');
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('project');
    expect(a[a.indexOf('--json-schema') + 1]).toBe('{"type":"object"}');
    expect(a[a.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    expect(a).toEqual(expect.arrayContaining(['--model', 'opus', '--effort', 'low', '--append-system-prompt', 'Be brief']));
  });

  it('uses no tools and no edit permission for extraction tasks', () => {
    const a = provider('success').buildArgs(spec({ taskType: 'extract' }));
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a).not.toContain('--permission-mode');
  });

  it('strips API key and nesting variables in subscription mode', () => {
    const p = new ClaudeCliProvider({ env: { PATH: '', ANTHROPIC_API_KEY: 'sk-test', CLAUDECODE: '1', KEEP: 'x' } });
    const env = p.childEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.KEEP).toBe('x');
  });

  it('health check reads version and login state', async () => {
    expect(await provider('success').healthCheck()).toMatchObject({ ok: true, installed: true, authed: true, version: '2.1.278' });
    expect(await provider('logged-out').healthCheck()).toMatchObject({ ok: false, installed: true, authed: false });
  });
});

describe('runStructured', () => {
  it('returns validated output', async () => {
    const r = await runStructured(provider('success'), spec({ taskType: 'extract' }), Band);
    expect(r).toMatchObject({ ok: true, value: { label: 'Band 6.5', confidence: 0.8 }, attempts: 1 });
  });

  it('repairs schema violations by resuming the same session', async () => {
    const rec = path.join(tmp, 'rec.jsonl');
    const r = await runStructured(provider('repair', { FAKE_RECORD: rec }), spec({ taskType: 'extract' }), Band);
    expect(r).toMatchObject({ ok: true, value: { confidence: 0.6 }, attempts: 2 });
    const calls = (await readFile(rec, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { args: string[]; stdin: string });
    expect(calls[1]!.args).toContain('--resume');
    expect(calls[1]!.stdin).toMatch(/confidence/);
  });

  it('falls back to parsing fenced JSON from the result text', async () => {
    const r = await runStructured(provider('text-json'), spec({ taskType: 'extract' }), Band);
    expect(r).toMatchObject({ ok: true, value: { label: 'Band 7' } });
  });

  it('surfaces provider errors', async () => {
    const r = await runStructured(provider('auth-fail'), spec({ taskType: 'extract' }), Band);
    expect(r.ok).toBe(false);
  });
});

describe('helpers', () => {
  it('parses npm .cmd shims to the real executable', async () => {
    const shim = path.join(tmp, 'claude.cmd');
    await writeFile(shim, '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n');
    const r = await parseCmdShim(shim);
    expect(r?.command).toBe(path.join(tmp, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
    expect(r?.prefixArgs).toEqual([]);
  });

  it('splits lines across chunk boundaries', () => {
    const s = new LineSplitter();
    expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(s.push(':2}\r\n')).toEqual(['{"b":2}']);
    expect(s.flush()).toEqual([]);
  });
});

describe.skipIf(!process.env.TUTORDESK_LIVE)('live Claude Code (TUTORDESK_LIVE=1)', () => {
  it('produces schema-valid JSON through the real CLI', async () => {
    const p = new ClaudeCliProvider();
    const health = await p.healthCheck();
    expect(health.ok, health.detail).toBe(true);
    const r = await runStructured(
      p,
      { taskType: 'extract', workspaceRoot: tmp, model: 'haiku', prompt: 'IELTS overall 6.5: give a short band label and your confidence (0-1).', permissions: { writableGlobs: [], readableGlobs: [], allowShell: false, allowNetwork: false } },
      Band,
    );
    expect(r.ok, r.ok ? '' : `${r.error} ${r.issues?.join('; ') ?? ''}`).toBe(true);
  }, 180_000);
});
