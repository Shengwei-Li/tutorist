import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@tutordesk/core';
import { ArtifactStudio } from '@tutordesk/pipeline';
import { handout } from '../../render/test/fixtures/docs.js';
import { essay, plan90, writingReview } from '../../pipeline/test/fakes.js';
import { Toolbox, writeAgentKit } from '../src/index.js';

const TEMPLATES = fileURLToPath(new URL('../../../workspace-template/templates/tex/', import.meta.url));

let tmp: string;
let ws: WorkspaceService;
let box: Toolbox;
let studentId: string;
let lessonId: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-toolbox-'));
  ws = await WorkspaceService.init(path.join(tmp, 'ws'));
  const p = await ws.createStudent({ name: 'Mina Park', exam: 'ielts-academic', targetOverall: 6.5, examDate: '2027-01-20' });
  studentId = p.id;
  await ws.appendError(studentId, { id: 'e1', code: 'W-TR-POS', excerpt: 'more and more people think crime is a big problem', source: 'submissions/2026-10-19-task2/text.md', date: '2026-10-19', status: 'open' });
  await ws.appendError(studentId, { id: 'e2', code: 'W-CC-CONC', excerpt: 'but education is most important', source: 'submissions/2026-10-19-task2/text.md', date: '2026-10-19', status: 'open' });
  lessonId = (await ws.createLesson(studentId, { date: '2026-10-28', topic: 'Task 2 position', minutes: 90 })).id;
  // No TeX engine: these tests cover the gates, not typesetting (packages/tex tests that).
  box = new Toolbox({ ws, templateDir: TEMPLATES, studio: { name: 'Northbridge English Studio' }, tutorName: 'Lin Chen', by: 'test-agent' });
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('Toolbox', () => {
  it('has no tool that approves plans, sets final bands or writes the error log', () => {
    const names = box.definitions().map((d) => d.name);
    expect(names).toContain('save_artifact');
    expect(names.filter((n) => /confirm|approve|final|error_log|append_error|delete/.test(n))).toEqual([]);
  });

  it('lists students and reads cited context', async () => {
    expect((await box.call('list_students', {})).text).toContain(`${studentId}: Mina Park, IELTS Academic target 6.5`);
    const ctx = await box.call('get_student_context', { studentId, lessonId });
    expect(ctx.isError).toBeUndefined();
    expect(ctx.text).toContain('W-TR-POS "more and more people think crime is a big problem"');
  });

  it('turns unknown ids and path tricks into fixable messages', async () => {
    expect(await box.call('get_student_context', { studentId: 'nobody' })).toMatchObject({ isError: true, text: expect.stringContaining('list_students') });
    expect(await box.call('get_lesson', { studentId: '../..', lessonId })).toMatchObject({ isError: true });
    expect(await box.call('get_lesson', { studentId, lessonId: 'nope' })).toMatchObject({ isError: true, text: expect.stringContaining('list_lessons') });
    expect(await box.call('nonexistent', {})).toMatchObject({ isError: true });
  });

  it('rejects a malformed plan with paths, saves a valid one as waiting for the tutor', async () => {
    const bad = await box.call('save_plan', { studentId, lessonId, plan: { ...plan90, stages: 'none' } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/stages/);

    const good = await box.call('save_plan', { studentId, lessonId, plan: JSON.stringify(plan90) });
    expect(good.isError).toBeUndefined();
    expect(good.text).toContain("waits for the tutor's approval");
    expect((await ws.readLesson(studentId, lessonId)).planConfirmed).toBe(false);
    expect((await box.call('get_lesson', { studentId, lessonId })).text).toContain('WAITING for tutor approval');
    expect((await ws.history(studentId, 1))[0]?.message).toContain('test-agent');
  });

  it('refuses artifacts until the tutor approves the plan, then saves and reports checks', async () => {
    await box.call('save_plan', { studentId, lessonId, plan: plan90 });
    const early = await box.call('save_artifact', { studentId, lessonId, kind: 'handout', doc: handout });
    expect(early).toMatchObject({ isError: true, text: expect.stringContaining('not approved') });

    await new ArtifactStudio({ ws, templateDir: TEMPLATES, studio: { name: 'x' }, tutorName: 'x' }).confirmPlan(studentId, lessonId, plan90);
    const malformed = await box.call('save_artifact', { studentId, lessonId, kind: 'handout', doc: { ...handout, blocks: [{ type: 'nope' }] } });
    expect(malformed).toMatchObject({ isError: true, text: expect.stringContaining('blocks.0') });

    const saved = await box.call('save_artifact', { studentId, lessonId, kind: 'handout', doc: handout });
    expect(saved.isError).toBeUndefined();
    expect(saved.text).toMatch(/Saved handout/);
    const qa = JSON.parse(await readFile(path.join(await ws.lessonDir(studentId, lessonId), 'qa', 'handout.json'), 'utf8'));
    expect(qa.by).toBe('test-agent');
    expect((await box.call('get_artifact', { studentId, lessonId, kind: 'handout' })).text).toContain('"kind": "handout"');
  });

  it('accepts an essay review only on confirmed text and with exact quotes', async () => {
    const sub = await ws.createSubmission(studentId, { kind: 'writing-task2', text: essay, date: '2026-10-27' });
    const lost = { ...writingReview, annotations: writingReview.annotations.map((a) => ({ ...a, quote: `${a.quote} (not in essay)` })) };
    const bad = await box.call('save_writing_review', { studentId, submissionId: sub.id, review: lost });
    expect(bad).toMatchObject({ isError: true, text: expect.stringContaining('not exact copies') });
    const ok = await box.call('save_writing_review', { studentId, submissionId: sub.id, review: writingReview });
    expect(ok.isError).toBeUndefined();
    expect((await ws.readSubmission(studentId, sub.id)).meta.status).toBe('reviewed');
    // The error log is untouched until the tutor finalises.
    expect((await ws.readErrors(studentId)).items).toHaveLength(2);
  });

  it('saves transcriptions as unconfirmed and refuses reviews of unconfirmed text', async () => {
    const sub = await ws.createSubmission(studentId, { kind: 'writing-task2', image: { name: 'essay.jpg', data: Buffer.from('jpg') }, date: '2026-10-27' });
    expect((await box.call('save_transcription', { studentId, submissionId: sub.id, text: essay })).isError).toBeUndefined();
    expect(await box.call('save_writing_review', { studentId, submissionId: sub.id, review: writingReview })).toMatchObject({ isError: true, text: expect.stringContaining('not confirmed') });
  });

  it('saves extracted material inside the student folder and attaches it to the lesson', async () => {
    const r = await box.call('save_material_text', { studentId, name: 'cam19-t2-reading', text: 'Passage 1 …', source: 'materials/raw/cam19.pdf p.24', lessonId });
    expect(r.isError).toBeUndefined();
    expect(existsSync(path.join(await ws.studentDir(studentId), 'materials/parsed/cam19-t2-reading.md'))).toBe(true);
    expect((await ws.readLesson(studentId, lessonId)).materials).toContain('materials/parsed/cam19-t2-reading.md');
    expect(await box.call('save_material_text', { studentId, name: '../escape', text: 'x', source: 'y' })).toMatchObject({ isError: true });
  });

  it('appends dated notes without rewriting existing ones', async () => {
    await box.call('append_note', { studentId, text: 'Ideas are strong; linking is mechanical.' });
    const notes = await readFile(path.join(await ws.studentDir(studentId), 'notes.md'), 'utf8');
    expect(notes).toMatch(/## \d{4}-\d{2}-\d{2} · test-agent\n\nIdeas are strong/);
  });

  it('serves schemas and guidelines from the shared knowledge', async () => {
    const s = await box.call('get_artifact_schema', { kind: 'deck' });
    expect(s.text).toContain('LAST frame must be a wrapup');
    expect(s.text).toContain('JSON Schema:');
    expect((await box.call('get_guidelines', { topic: 'pte' })).text).toContain('Summarize Written Text');
  });
});

describe('writeAgentKit', () => {
  it('writes AGENTS.md, CLAUDE.md and skills for every harness', async () => {
    const files = await writeAgentKit(ws.root);
    expect(files).toContain('AGENTS.md');
    expect(await readFile(path.join(ws.root, 'CLAUDE.md'), 'utf8')).toContain('@AGENTS.md');
    for (const root of ['.claude/skills', '.agents/skills']) {
      const skill = await readFile(path.join(ws.root, root, 'tutordesk-lesson-prep', 'SKILL.md'), 'utf8');
      expect(skill).toMatch(/^---\nname: tutordesk-lesson-prep\ndescription: /);
    }
    expect(await readFile(path.join(ws.root, '.claude/skills/tutordesk-exam-ielts/SKILL.md'), 'utf8')).toContain('Task 2 counts twice');
  });
});
