import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@tutordesk/core';
import { Toolbox, apiSystemPrompt } from '@tutordesk/toolbox';
import { ApiSession, type HarnessEvent, type PermissionMode } from '../src/index.js';

const TEMPLATES = fileURLToPath(new URL('../../../workspace-template/templates/tex/', import.meta.url));

type StreamResult = Awaited<ReturnType<MockLanguageModelV4['doStream']>>;
type Chunk = Record<string, unknown>;

const usage = { inputTokens: { total: 120, noCache: 100, cacheRead: 20, cacheWrite: 0 }, outputTokens: { total: 30, text: 30, reasoning: 0 } };
const finish = (unified: 'stop' | 'tool-calls'): Chunk => ({ type: 'finish', finishReason: { unified, raw: unified }, usage });
const say = (t: string): Chunk[] => [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: t }, { type: 'text-end', id: 't' }];
const call = (id: string, toolName: string, input: unknown): Chunk => ({ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) });
const stream = (chunks: Chunk[], chunkDelayInMs?: number): StreamResult =>
  ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...chunks], chunkDelayInMs }) }) as unknown as StreamResult;

let tmp: string;
let ws: WorkspaceService;
let studentId: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-api-session-'));
  ws = await WorkspaceService.init(path.join(tmp, 'ws'));
  studentId = (await ws.createStudent({ name: 'Mina Park', exam: 'ielts-academic', targetOverall: 6.5, examDate: '2027-01-20' })).id;
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function session(model: MockLanguageModelV4, mode: PermissionMode = 'guarded', resume?: string) {
  const toolbox = new Toolbox({ ws, templateDir: TEMPLATES, studio: { name: 'Studio' }, tutorName: 'Lin', by: 'api:mock' });
  return new ApiSession({ cwd: ws.root, mode, resume, instructions: `Student ${studentId}.`, mcp: { command: '', args: [] } }, { model, modelLabel: 'mock:model', toolbox, system: apiSystemPrompt() });
}

async function collect(s: ApiSession, text: string, onEvent?: (e: HarnessEvent) => void): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of s.send({ text })) {
    out.push(e);
    onEvent?.(e);
  }
  return out;
}

function scripted(turns: Chunk[][], delay?: number) {
  let n = 0;
  return new MockLanguageModelV4({ doStream: async () => stream(turns[n++] ?? [...say('(no more script)'), finish('stop')], delay) });
}

describe('ApiSession (H6)', () => {
  it('runs the toolbox in-process, streams the answer and keeps the conversation', async () => {
    const model = scripted([[call('c1', 'get_student_context', { studentId }), finish('tool-calls')], [...say('Mina needs a clear position.'), finish('stop')], [...say('Yes.'), finish('stop')]]);
    const s = session(model);
    await s.start();
    const events = await collect(s, 'What should Mina work on?');
    expect(events[0]).toMatchObject({ type: 'session', model: 'mock:model' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool', server: 'tutordesk', name: 'get_student_context', status: 'running' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool', name: 'get_student_context', status: 'ok', summary: expect.stringContaining('Mina Park') }));
    expect(events).toContainEqual({ type: 'text', delta: 'Mina needs a clear position.' });
    expect(events.find((e) => e.type === 'usage')).toMatchObject({ inputTokens: 240, outputTokens: 60, cachedTokens: 40 });
    expect(events.at(-1)).toEqual({ type: 'turn_end', status: 'completed', error: undefined });

    // The system prompt carries the workflows; guarded mode has no free-form write tool.
    const first = model.doStreamCalls[0]!;
    expect(JSON.stringify(first.prompt[0])).toContain('Lesson preparation');
    expect((first.tools ?? []).map((t) => t.name)).toEqual(expect.arrayContaining(['read_file', 'save_artifact']));
    expect((first.tools ?? []).map((t) => t.name)).not.toContain('write_markdown');

    // A resumed session continues the same conversation from disk.
    const again = session(model, 'guarded', s.nativeId!);
    await again.start();
    await collect(again, 'Sure?');
    const resumedPrompt = model.doStreamCalls[2]!.prompt;
    expect(resumedPrompt.filter((m) => m.role === 'user')).toHaveLength(2);
    expect(resumedPrompt.some((m) => m.role === 'tool')).toBe(true);
  });

  it('marks tool errors so the UI can show them', async () => {
    const model = scripted([[call('c1', 'get_lesson', { studentId, lessonId: 'nope' }), finish('tool-calls')], [...say('No such lesson.'), finish('stop')]]);
    const s = session(model);
    await s.start();
    const events = await collect(s, 'Open lesson nope');
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool', name: 'get_lesson', status: 'error', summary: expect.stringContaining('list_lessons') }));
  });

  it('asks the tutor before writing Markdown in collaborate mode', async () => {
    const model = scripted([[call('w1', 'write_markdown', { path: `students/${studentId}/summary.md`, content: '# Summary' }), finish('tool-calls')], [...say('Written.'), finish('stop')]]);
    const s = session(model, 'collaborate');
    await s.start();
    const events = await collect(s, 'Write a summary', (e) => {
      if (e.type === 'approval') s.respond(e.requestId, 'allow');
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'approval', kind: 'edit', title: `Write students/${studentId}/summary.md` }));
    expect(await readFile(path.join(ws.root, 'students', studentId, 'summary.md'), 'utf8')).toBe('# Summary');
  });

  it('refuses Markdown writes outside students/ and anything when the tutor declines', async () => {
    const model = scripted([[call('w1', 'write_markdown', { path: 'AGENTS.md', content: 'x' }), call('w2', 'write_markdown', { path: `students/${studentId}/x.md`, content: 'x' }), finish('tool-calls')], [...say('ok'), finish('stop')]]);
    const s = session(model, 'collaborate');
    await s.start();
    const events = await collect(s, 'Try', (e) => {
      if (e.type === 'approval') s.respond(e.requestId, 'deny');
    });
    expect(events.filter((e) => e.type === 'tool' && e.status === 'error')).toHaveLength(2);
    expect(existsSync(path.join(ws.root, 'students', studentId, 'x.md'))).toBe(false);
  });

  it('interrupts a turn and keeps the question in the history', async () => {
    const model = scripted([[...say('a'), ...say('b'), ...say('c'), finish('stop')]], 200);
    const s = session(model);
    await s.start();
    const done = collect(s, 'Long answer please');
    await new Promise((r) => setTimeout(r, 250));
    await s.interrupt();
    expect((await done).at(-1)).toMatchObject({ type: 'turn_end', status: 'interrupted' });
    const saved = JSON.parse(await readFile(path.join(ws.root, '.tutordesk', 'api-sessions', `${s.nativeId}.json`), 'utf8'));
    expect(saved.messages).toHaveLength(1);
  });

  it('reports model errors as a failed turn', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('401 invalid key');
      },
    });
    const s = session(model);
    await s.start();
    const events = await collect(s, 'Hi');
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', status: 'failed', error: expect.stringContaining('401') });
  });
});
