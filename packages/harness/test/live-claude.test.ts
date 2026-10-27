import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WorkspaceService } from '@tutordesk/core';
import { writeAgentKit } from '@tutordesk/toolbox';
import { ClaudeCodeSession, tutordeskMcpLaunch, type HarnessEvent } from '../src/index.js';

/**
 * One small real turn with the local Claude Code on the user's subscription (appendix E.10).
 * Opt in: TUTORDESK_LIVE_HARNESS=1, after `pnpm mcp:build`. Model: TUTORDESK_LIVE_MODEL (default haiku).
 */
const LIVE = process.env.TUTORDESK_LIVE_HARNESS === '1';
const SERVER = fileURLToPath(new URL('../../toolbox/dist/tutordesk-mcp.mjs', import.meta.url));
const TEMPLATE = fileURLToPath(new URL('../../../workspace-template/', import.meta.url));

describe.skipIf(!LIVE)('Claude Code live smoke', () => {
  it('reads the workspace through the tutordesk tools in guarded mode', async () => {
    expect(existsSync(SERVER), 'run pnpm mcp:build first').toBe(true);
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-live-'));
    const ws = await WorkspaceService.init(path.join(tmp, 'ws'), TEMPLATE);
    await writeAgentKit(ws.root);
    const student = await ws.createStudent({ name: 'Mina Park', exam: 'ielts-academic', targetOverall: 6.5, examDate: '2027-01-20' });
    const lesson = await ws.createLesson(student.id, { date: '2026-10-28', topic: 'Task 2 position', minutes: 60 });

    const s = new ClaudeCodeSession({
      cwd: ws.root,
      mode: 'guarded',
      model: process.env.TUTORDESK_LIVE_MODEL ?? 'haiku',
      instructions: `You are working on lesson "${lesson.id}" of student ${student.id}.`,
      mcp: tutordeskMcpLaunch({ serverScript: SERVER, workspace: ws.root, by: 'claude-code', runtime: process.execPath }),
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
