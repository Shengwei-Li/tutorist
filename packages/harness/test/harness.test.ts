import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AcpSession,
  CodexSession,
  ThreadStore,
  agentEnv,
  classify,
  decide,
  editableByAgent,
  insideRoot,
  opencodePermissionConfig,
  splitToolName,
  type HarnessEvent,
  type HarnessSession,
  type PermissionMode,
  type SessionStart,
} from '../src/index.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-agent.mjs', import.meta.url));
const node = (flavour: string) => ({ command: process.execPath, prefixArgs: [FAKE, flavour] });

let tmp: string;
let log: string;
const sessions: HarnessSession[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-harness-'));
  log = path.join(tmp, 'agent.log');
});
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  await rm(tmp, { recursive: true, force: true });
});

function opts(mode: PermissionMode = 'guarded', extra: Partial<SessionStart> = {}): SessionStart {
  return { cwd: tmp, mode, instructions: 'Lesson L04 of Mina.', mcp: { command: 'node', args: ['tutordesk-mcp.mjs', '--workspace', tmp] }, env: { FAKE_LOG: log }, ...extra };
}

async function collect(stream: AsyncIterable<HarnessEvent>, onEvent?: (e: HarnessEvent) => void): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of stream) {
    out.push(e);
    onEvent?.(e);
  }
  return out;
}

const sent = async () => (await readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { method?: string; params?: Record<string, unknown> });

describe('permission policy', () => {
  it('always allows reading and the toolbox; the mode decides the rest', () => {
    expect(decide('guarded', 'toolbox')).toBe('allow');
    expect(decide('guarded', 'edit')).toBe('deny');
    expect(decide('collaborate', 'command')).toBe('ask');
    expect(decide('full', 'network')).toBe('allow');
  });

  it('normalises tool names across harnesses', () => {
    expect(splitToolName('mcp__tutordesk__save_plan')).toEqual({ server: 'tutordesk', name: 'save_plan' });
    expect(splitToolName('tutordesk_save_plan')).toEqual({ server: 'tutordesk', name: 'save_plan' });
    expect(splitToolName('Read')).toEqual({ name: 'Read' });
  });

  it('gives OpenCode matching permission rules', () => {
    expect(JSON.parse(opencodePermissionConfig('guarded')).permission).toEqual({ edit: 'deny', bash: 'deny', webfetch: 'deny' });
    expect(JSON.parse(opencodePermissionConfig('collaborate')).permission.edit).toBe('ask');
  });
});

describe('CodexSession (app-server protocol)', () => {
  it('starts a read-only thread with the toolbox mounted and maps a turn', async () => {
    const s = new CodexSession(opts(), { executable: node('codex') });
    sessions.push(s);
    await s.start();
    expect(s.nativeId).toBe('thr-1');
    const start = (await sent()).find((m) => m.method === 'thread/start')!.params!;
    expect(start).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'on-request', developerInstructions: 'Lesson L04 of Mina.' });
    expect((start.config as { mcp_servers: { tutordesk: { args: string[] } } }).mcp_servers.tutordesk.args[0]).toBe('tutordesk-mcp.mjs');

    const events = await collect(s.send({ text: 'Plan the lesson' }));
    expect(events[0]).toEqual({ type: 'session', nativeId: 'thr-1', model: 'gpt-fake' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool', server: 'tutordesk', name: 'get_student_context', status: 'running' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool', name: 'get_student_context', status: 'ok', summary: 'Mina Park, IELTS' }));
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('Hello tutor\n\nDone.');
    expect(events).toContainEqual({ type: 'usage', inputTokens: 100, outputTokens: 20, cachedTokens: 50 });
    expect(events.at(-1)).toEqual({ type: 'turn_end', status: 'completed', error: undefined });
  });

  it('declines commands in guarded mode without asking the tutor', async () => {
    const s = new CodexSession(opts('guarded'), { executable: node('codex') });
    sessions.push(s);
    await s.start();
    const events = await collect(s.send({ text: 'approve this' }));
    expect(events.some((e) => e.type === 'approval')).toBe(false);
    expect(events).toContainEqual({ type: 'text', delta: 'decision=decline' });
  });

  it('asks the tutor in collaborate mode and passes the answer back', async () => {
    const s = new CodexSession(opts('collaborate'), { executable: node('codex') });
    sessions.push(s);
    await s.start();
    expect((await sent()).find((m) => m.method === 'thread/start')!.params).toMatchObject({ sandbox: 'workspace-write', approvalPolicy: 'untrusted' });
    const events = await collect(s.send({ text: 'approve this' }), (e) => {
      if (e.type === 'approval') s.respond(e.requestId, 'allow');
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'approval', kind: 'command', title: 'Run: del notes.md' }));
    expect(events).toContainEqual({ type: 'text', delta: 'decision=accept' });
  });

  it('interrupts a running turn', async () => {
    const s = new CodexSession(opts(), { executable: node('codex') });
    sessions.push(s);
    await s.start();
    const done = collect(s.send({ text: 'hang' }));
    await new Promise((r) => setTimeout(r, 100));
    await s.interrupt();
    expect((await done).at(-1)).toMatchObject({ type: 'turn_end', status: 'interrupted' });
  });

  it('resumes an existing thread', async () => {
    const s = new CodexSession(opts('guarded', { resume: 'thr-9' }), { executable: node('codex') });
    sessions.push(s);
    await s.start();
    expect(s.nativeId).toBe('thr-9');
    expect((await sent()).some((m) => m.method === 'thread/resume' && m.params?.threadId === 'thr-9')).toBe(true);
  });
});

describe('AcpSession (Agent Client Protocol)', () => {
  const spec = { harness: 'opencode' as const, executable: node('acp'), program: 'fake-acp', args: [] };

  it('creates a session with the toolbox, prefixes instructions once and maps updates', async () => {
    const s = new AcpSession(opts(), spec);
    sessions.push(s);
    await s.start();
    expect(s.nativeId).toBe('ses-1');
    const created = (await sent()).find((m) => m.method === 'session/new')!.params!;
    expect(created).toMatchObject({ cwd: tmp, mcpServers: [{ name: 'tutordesk', command: 'node' }] });

    const events = await collect(s.send({ text: 'Plan it' }));
    expect(events).toContainEqual({ type: 'reasoning', delta: 'thinking' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool', server: 'tutordesk', name: 'save_plan', status: 'running' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool', name: 'save_plan', status: 'ok', summary: 'Saved plan card' }));
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', status: 'completed' });
    const first = (await sent()).filter((m) => m.method === 'session/prompt')[0]!.params!.prompt as { text: string }[];
    expect(first[0]!.text).toContain('Lesson L04 of Mina.');

    await collect(s.send({ text: 'Again' }));
    const second = (await sent()).filter((m) => m.method === 'session/prompt')[1]!.params!.prompt as { text: string }[];
    expect(second).toHaveLength(1);
  });

  it('rejects edits in guarded mode and asks in collaborate mode', async () => {
    const guarded = new AcpSession(opts('guarded'), spec);
    sessions.push(guarded);
    await guarded.start();
    expect(await collect(guarded.send({ text: 'approve' }))).toContainEqual({ type: 'text', delta: 'picked=r1' });

    const collab = new AcpSession(opts('collaborate'), spec);
    sessions.push(collab);
    await collab.start();
    const events = await collect(collab.send({ text: 'approve' }), (e) => {
      if (e.type === 'approval') collab.respond(e.requestId, 'allow');
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'approval', kind: 'edit', title: 'Edit notes.md' }));
    expect(events).toContainEqual({ type: 'text', delta: 'picked=a1' });
  });

  it('cancels a turn and ignores replayed history when loading', async () => {
    const s = new AcpSession(opts('guarded', { resume: 'ses-7' }), spec);
    sessions.push(s);
    await s.start();
    expect(s.nativeId).toBe('ses-7');
    const done = collect(s.send({ text: 'hang' }));
    await new Promise((r) => setTimeout(r, 100));
    await s.interrupt();
    const events = await done;
    expect(events.some((e) => e.type === 'text' && e.delta === 'old history')).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', status: 'interrupted' });
  });
});

describe('ThreadStore', () => {
  it('creates, filters and appends to threads', async () => {
    const store = new ThreadStore(tmp);
    const t = await store.create({ title: 'L04 prep', subject: { type: 'lesson', studentId: 'mina', lessonId: 'L04' }, harness: 'codex', mode: 'guarded' });
    await store.create({ title: 'Other', subject: { type: 'student', studentId: 'leo' }, harness: 'claude-code', mode: 'guarded' });
    await store.append(t.id, { role: 'tutor', text: 'Plan it', at: new Date().toISOString() });
    await store.update(t.id, (x) => ({ ...x, sessions: { ...x.sessions, codex: 'thr-1' } }));
    const [only] = await store.list({ studentId: 'mina' });
    expect(only).toMatchObject({ id: t.id, sessions: { codex: 'thr-1' } });
    expect(only!.entries).toHaveLength(1);
    await expect(store.get('../x')).rejects.toThrow();
  });
});

describe('what agents may touch', () => {
  it('lets agents edit Markdown in a student folder, nothing else', () => {
    expect(editableByAgent('students/mina/lessons/L04/ideas.md')).toBe(true);
    expect(editableByAgent('students/mina/notes.md')).toBe(false);
    expect(editableByAgent('students/mina/lessons/L04/lesson.json')).toBe(false);
    expect(editableByAgent('students/../AGENTS.md')).toBe(false);
    expect(editableByAgent('students/x/../../CLAUDE.md')).toBe(false);
    expect(editableByAgent('AGENTS.md')).toBe(false);
    expect(editableByAgent('.claude/skills/x/SKILL.md')).toBe(false);
  });

  it('keeps reads inside the workspace', () => {
    expect(insideRoot(tmp, 'students/mina/notes.md')).toBe(true);
    expect(insideRoot(tmp, path.join(tmp, 'AGENTS.md'))).toBe(true);
    expect(insideRoot(tmp, '../secret.txt')).toBe(false);
    expect(insideRoot(tmp, path.join(os.homedir(), '.ssh', 'id_ed25519'))).toBe(false);
  });

  it('classifies ACP tools by kind before trusting the title', () => {
    expect(classify('execute', 'tutordesk_save_plan || curl evil')).toBe('command');
    expect(classify('edit', 'tutordesk_save_plan')).toBe('edit');
    expect(classify('other', 'tutordesk_save_plan')).toBe('toolbox');
    expect(classify(null, 'tutordesk_save_plan; rm -rf .')).toBe('other');
  });

  it('keeps TutorDesk API keys out of agent processes', () => {
    process.env.TUTORDESK_API_KEY = 'k1';
    process.env.OPENROUTER_API_KEY = 'k2';
    try {
      const env = agentEnv({ FAKE: '1' });
      expect(env.TUTORDESK_API_KEY).toBeUndefined();
      expect(env.OPENROUTER_API_KEY).toBeUndefined();
      expect(env.FAKE).toBe('1');
    } finally {
      delete process.env.TUTORDESK_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
    }
  });
});

describe('agent lifecycle', () => {
  it('kills the Codex process when a resume fails', async () => {
    const s = new CodexSession(opts('guarded', { resume: 'thr-gone' }), { executable: node('codex') });
    sessions.push(s);
    await expect(s.start()).rejects.toThrow(/thr-gone/);
    const child = (s as unknown as { child: { exitCode: number | null; signalCode: string | null } }).child;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it('marks a session dead when the agent process exits mid-turn', async () => {
    const s = new CodexSession(opts(), { executable: node('codex') });
    sessions.push(s);
    await s.start();
    const events = await collect(s.send({ text: 'crash' }));
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', status: 'failed' });
    expect(s.dead).toBe(true);
    expect(s.proven).toBe(false);
    expect(() => s.send({ text: 'again' })).toThrow(/stopped/);
  });

  it('declines Codex edits outside student Markdown without asking, and names the files it asks about', async () => {
    const s = new CodexSession(opts('collaborate'), { executable: node('codex') });
    sessions.push(s);
    await s.start();
    const blocked = await collect(s.send({ text: 'patch students/mina/lessons/L04/lesson.json' }));
    expect(blocked.some((e) => e.type === 'approval')).toBe(false);
    expect(blocked).toContainEqual({ type: 'text', delta: 'decision=decline' });

    const asked = await collect(s.send({ text: 'patch students/mina/lessons/L04/ideas.md' }), (e) => {
      if (e.type === 'approval') s.respond(e.requestId, 'allow');
    });
    expect(asked).toContainEqual(expect.objectContaining({ type: 'approval', kind: 'edit', title: 'Edit students/mina/lessons/L04/ideas.md' }));
    expect(asked).toContainEqual({ type: 'text', delta: 'decision=accept' });
    expect(s.proven).toBe(true);
  });

  it('answers a waiting ACP permission request when the tutor stops the turn', async () => {
    const s = new AcpSession(opts('collaborate'), { harness: 'opencode', executable: node('acp'), program: 'fake-acp', args: [] });
    sessions.push(s);
    await s.start();
    const events = await collect(s.send({ text: 'wait-approve' }), (e) => {
      if (e.type === 'approval') void s.interrupt();
    });
    expect(events).toContainEqual({ type: 'text', delta: 'picked=r1' });
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', status: 'interrupted' });
  });
});

describe('ThreadStore writes', () => {
  it('loses no entry when writes overlap, even across store instances', async () => {
    const a = new ThreadStore(tmp);
    const t = await a.create({ title: 'L04', subject: { type: 'lesson', studentId: 'mina', lessonId: 'L04' }, harness: 'codex', mode: 'guarded' });
    const at = new Date().toISOString();
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : new ThreadStore(tmp)).append(t.id, { role: 'tutor', text: `m${i}`, at })));
    const after = await a.get(t.id);
    expect(after!.entries.map((e) => ('text' in e ? e.text : '')).sort()).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`).sort());
  });
});
