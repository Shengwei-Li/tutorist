import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WorkspaceService } from '@tutordesk/core';
import { writeAgentKit } from '@tutordesk/toolbox';
import { createSession, tutordeskMcpLaunch, type CliHarnessId as HarnessId, type HarnessEvent } from '../src/index.js';

/**
 * One small real turn with a local agent on the user's own subscription (appendix E.10). Opt in after
 * `pnpm mcp:build`: TUTORDESK_LIVE_HARNESS=claude-code,codex (or 1 for Claude Code).
 * Models default to the cheap ones; override with TUTORDESK_LIVE_MODEL.
 */
const SELECTED = (process.env.TUTORDESK_LIVE_HARNESS ?? '').split(',').map((h) => (h === '1' ? 'claude-code' : h.trim()));
const CHEAP: Record<HarnessId, string | undefined> = { 'claude-code': 'haiku', codex: 'gpt-6-luna', opencode: undefined };
const SERVER = fileURLToPath(new URL('../../toolbox/dist/tutordesk-mcp.mjs', import.meta.url));
const TEMPLATE = fileURLToPath(new URL('../../../workspace-template/', import.meta.url));

const HARNESSES = (['claude-code', 'codex', 'opencode'] as HarnessId[]).filter((h) => SELECTED.includes(h));

describe.skipIf(!HARNESSES.length)('live harness smoke', () => {
  it.each(HARNESSES.length ? HARNESSES : (['claude-code'] as HarnessId[]))('%s reads the workspace through the tutordesk tools in guarded mode', async (harness) => {
    expect(existsSync(SERVER), 'run pnpm mcp:build first').toBe(true);
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-live-'));
    const ws = await WorkspaceService.init(path.join(tmp, 'ws'), TEMPLATE);
    await writeAgentKit(ws.root);
    const student = await ws.createStudent({ name: 'Mina Park', exam: 'ielts-academic', targetOverall: 6.5, examDate: '2027-01-20' });
    const lesson = await ws.createLesson(student.id, { date: '2026-10-28', topic: 'Task 2 position', minutes: 60 });

    const s = createSession(harness, {
      cwd: ws.root,
      mode: 'guarded',
      model: process.env.TUTORDESK_LIVE_MODEL ?? CHEAP[harness],
      instructions: `You are working on lesson "${lesson.id}" of student ${student.id}.`,
      mcp: tutordeskMcpLaunch({ serverScript: SERVER, workspace: ws.root, by: harness, runtime: process.execPath }),
    });
    const events: HarnessEvent[] = [];
    try {
      await s.start();
      for await (const e of s.send({
        text: `Call the tutordesk tools list_students and then get_lesson for studentId "${student.id}" and lessonId "${lesson.id}". Then answer in one sentence: the student's name and whether the plan card is approved. Do nothing else.`,
      })) {
        events.push(e);
        if (e.type === 'tool' || e.type === 'turn_end' || e.type === 'usage' || e.type === 'session' || e.type === 'notice' || e.type === 'approval') console.log(JSON.stringify(e).slice(0, 300));
      }
    } finally {
      await s.close();
      await rm(tmp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    }
    const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
    console.log('ANSWER:', text);
    expect(events.find((e) => e.type === 'session')).toBeTruthy();
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool', server: 'tutordesk', name: 'get_lesson', status: 'ok' }));
    expect(events.at(-1)).toMatchObject({ type: 'turn_end', status: 'completed' });
    expect(text).toMatch(/Mina/);
  }, 180_000);
});

/**
 * Collaborate mode must not let Codex change structured files on its own: its workspace-write sandbox
 * could apply a patch without asking. Opt in with TUTORDESK_LIVE_HARNESS=codex-gate (one small turn).
 */
describe.skipIf(!SELECTED.includes('codex-gate'))('live Codex collaborate gate', () => {
  it('keeps lesson.json out of reach even when the tutor allows everything', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-live-gate-'));
    const ws = await WorkspaceService.init(path.join(tmp, 'ws'), TEMPLATE);
    await writeAgentKit(ws.root);
    const student = await ws.createStudent({ name: 'Mina Park', exam: 'ielts-academic', targetOverall: 6.5, examDate: '2027-01-20' });
    const lesson = await ws.createLesson(student.id, { date: '2026-10-28', topic: 'Task 2 position', minutes: 60 });
    const file = path.join(ws.root, 'students', student.id, 'lessons', lesson.id, 'lesson.json');
    const before = await readFile(file, 'utf8');

    const s = createSession('codex', {
      cwd: ws.root,
      mode: 'collaborate',
      model: process.env.TUTORDESK_LIVE_MODEL ?? CHEAP.codex,
      mcp: tutordeskMcpLaunch({ serverScript: SERVER, workspace: ws.root, by: 'codex', runtime: process.execPath }),
    });
    const events: HarnessEvent[] = [];
    try {
      await s.start();
      for await (const e of s.send({
        text: `This is a permissions test. 1) Change "planConfirmed" to true in students/${student.id}/lessons/${lesson.id}/lesson.json, without the tutordesk tools; try once. 2) Create students/${student.id}/lessons/${lesson.id}/ideas.md containing the line "# Ideas" with your file editing. Then report in one sentence what worked.`,
      })) {
        events.push(e);
        // The tutor allows whatever is asked: the adapter itself must keep lesson.json out of reach.
        if (e.type === 'approval') s.respond(e.requestId, 'allow');
        if (e.type !== 'text' && e.type !== 'reasoning') console.log(JSON.stringify(e).slice(0, 300));
      }
      console.log('ANSWER:', events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join(''));
      expect(await readFile(file, 'utf8')).toBe(before);
      console.log('ideas.md written:', existsSync(path.join(path.dirname(file), 'ideas.md')));
    } finally {
      await s.close();
      await rm(tmp, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
    }
  }, 240_000);
});
