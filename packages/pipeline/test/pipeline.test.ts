import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '@tutordesk/core';
import type { DeckDoc, WorksheetDoc } from '@tutordesk/core/artifacts';
import { TexEngine, detectSystemTex } from '@tutordesk/tex';
import { deck, handout, script, worksheet } from '../../render/test/fixtures/docs.js';
import { LessonPipeline, WritingReviewer, buildContext, checkDeck, checkPlan, checkWorksheet, countWords, locate, validateReview } from '../src/index.js';
import { FakeProvider, essay, plan90, promptKind, review, writingReview } from './fakes.js';

const TEMPLATES = fileURLToPath(new URL('../../../workspace-template/templates/tex/', import.meta.url));
const DOCS = { handout, worksheet, script, deck };

let tmp: string;
let ws: WorkspaceService;
let studentId: string;
let lessonId: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-pipe-'));
  ws = await WorkspaceService.init(path.join(tmp, 'ws'));
  const p = await ws.createStudent({ name: 'Mina Park', exam: 'ielts-academic', targetOverall: 6.5, examDate: '2027-01-20' });
  studentId = p.id;
  await writeFile(path.join(await ws.studentDir(studentId), 'notes.md'), '# Notes on Mina Park\n\nTired after school; prefers concrete examples.\n');
  await ws.appendError(studentId, { id: 'e1', code: 'W-TR-POS', excerpt: 'more and more people think crime is a big problem', source: 'submissions/2026-10-19-task2/text.md', date: '2026-10-19', status: 'open' });
  await ws.appendError(studentId, { id: 'e2', code: 'W-CC-CONC', excerpt: 'but education is most important', source: 'submissions/2026-10-19-task2/text.md', date: '2026-10-19', status: 'open' });
  lessonId = (await ws.createLesson(studentId, { date: '2026-10-28', topic: 'Task 2 position', minutes: 90 })).id;
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const base = () => ({ ws, templateDir: TEMPLATES, studio: { name: 'Northbridge English Studio', monogram: 'NE' }, tutorName: 'Lin Chen' });

describe('deterministic checks', () => {
  it('plan: time total, missing check stage, vague objectives, personalisation', () => {
    expect(checkPlan(plan90, 90, 2).filter((c) => c.severity === 'error')).toEqual([]);
    const bad = { ...plan90, stages: plan90.stages.map((s) => ({ ...s, phase: s.phase === 'check' ? ('independent' as const) : s.phase, minutes: s.id === 'st1' ? 10 : s.minutes })), objectives: [{ ...plan90.objectives[0]!, text: 'Understand PEEL' }], focusErrors: plan90.focusErrors.slice(0, 1) };
    const ids = checkPlan(bad, 90, 2).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['time-total', 'has-check', 'objective-measurable', 'personalised']));
  });

  it('catches classroom wording, promises and invented exam rules', () => {
    const t = (s: string) => checkWorksheet({ ...worksheet, meta: { ...worksheet.meta, subtitle: s } }).map((c) => c.id);
    expect(t('Students, open your books')).toContain('one-to-one');
    expect(t('We guarantee a band 7')).toContain('no-promises');
    expect(t('Remember Task 2 is worth 66% of the mark')).toContain('exam-facts');
    expect(t('The overall band is rounded down')).toContain('exam-facts');
    expect(t('Word class practice')).not.toContain('one-to-one');
    expect(t('Should university be free for everyone?')).not.toContain('one-to-one');
    expect(t('OK. Everyone, look at paragraph B')).toContain('one-to-one');
  });

  it('worksheet answer keys and deck budgets', () => {
    const broken: WorksheetDoc = JSON.parse(JSON.stringify(worksheet));
    const mcq = broken.exercises[2]!.items[0]!;
    if (mcq.type === 'mcq') mcq.answer = 9;
    const r = broken.exercises[4]!.items[0]!;
    if (r.type === 'reorder') r.paragraphs.forEach((p, i) => (p.position = i + 1));
    expect(checkWorksheet(broken).filter((c) => c.id === 'answer-key')).toHaveLength(2);

    const d: DeckDoc = JSON.parse(JSON.stringify(deck));
    const f = d.frames[1]!;
    if (f.type === 'frame' && f.blocks[0]!.type === 'compare') f.blocks[0]!.notes.pop();
    expect(checkDeck(d).map((c) => c.id)).toContain('compare-notes');
  });
});

describe('context', () => {
  it('cites profile, notes, errors and the lesson', async () => {
    const ctx = await buildContext(ws, studentId, lessonId);
    expect(ctx.text).toContain('IELTS Academic; target overall 6.5');
    expect(ctx.text).toContain('Tired after school');
    expect(ctx.text).toContain('W-TR-POS "more and more people think crime is a big problem" (submissions/2026-10-19-task2/text.md');
    expect(ctx.text).toContain('90 minutes');
    expect(ctx.openErrors).toHaveLength(2);
  });
});

describe('LessonPipeline', () => {
  it('plans, repairs a bad time total once, and waits for approval', async () => {
    const provider = new FakeProvider((spec, n) => {
      const k = promptKind(spec.prompt);
      if (k === 'plan') return { ...plan90, stages: plan90.stages.map((s) => (s.id === 'st6' ? { ...s, minutes: 20 } : s)) };
      if (k === 'revise') return plan90;
      throw new Error(`unexpected ${k} at ${n}`);
    });
    const pipe = new LessonPipeline({ ...base(), provider });
    const { plan, report } = await pipe.plan(studentId, lessonId, { brief: 'Focus on the introduction' });
    expect(report).toMatchObject({ rounds: 1, passed: true });
    expect(plan.stages.reduce((a, s) => a + s.minutes, 0)).toBe(90);
    expect(provider.calls[0]!.systemAppend).toContain('Overall band = mean of the four skills');
    expect(provider.calls[0]!.prompt).toContain('Focus on the introduction');
    expect((await ws.readLesson(studentId, lessonId)).planConfirmed).toBe(false);
    await expect(pipe.generate(studentId, lessonId, 'handout')).rejects.toThrow(/Approve the plan/);
    await pipe.confirmPlan(studentId, lessonId, plan);
    expect((await ws.readLesson(studentId, lessonId)).planConfirmed).toBe(true);
    expect((await ws.history(studentId)).map((c) => c.message)).toContain(`Approve plan for ${lessonId}`);
  });

  it('generates, reviews, revises on a low score, then saves with a QA report', async () => {
    let reviews = 0;
    const provider = new FakeProvider((spec) => {
      const k = promptKind(spec.prompt);
      if (k === 'review') return review(reviews++ === 0 ? 3 : 5);
      if (k === 'handout' || k === 'revise') return handout;
      throw new Error(`unexpected ${k}`);
    });
    const steps: string[] = [];
    const pipe = new LessonPipeline({ ...base(), provider, onEvent: (e) => e.type === 'step' && steps.push(`${e.step}:${e.status}`) });
    await ws.writeLessonFile(studentId, lessonId, 'plan.json', plan90);
    await pipe.confirmPlan(studentId, lessonId, plan90);
    const { report } = await pipe.generate(studentId, lessonId, 'handout');
    expect(report).toMatchObject({ kind: 'handout', rounds: 1, passed: true });
    expect(report.usd).toBeCloseTo(0.04);
    const revisePrompt = provider.calls.find((c) => promptKind(c.prompt) === 'revise')!.prompt;
    expect(revisePrompt).toContain('Use Mina’s own sentence E1');
    expect(provider.calls.find((c) => promptKind(c.prompt) === 'review')!.model).toBe('balanced');
    expect(steps).toEqual(expect.arrayContaining(['generate:start', 'review:start', 'revise:start', 'save:done']));
    expect(await ws.readLessonJson(studentId, lessonId, 'qa/handout.json', (await import('zod')).z.any())).toMatchObject({ passed: true });
    expect((await ws.readLesson(studentId, lessonId)).status).toBe('prepared');
  });

  it('stops after two revision rounds and flags the tutor', async () => {
    const provider = new FakeProvider((spec) => (promptKind(spec.prompt) === 'review' ? review(2) : script));
    const pipe = new LessonPipeline({ ...base(), provider });
    await ws.writeLessonFile(studentId, lessonId, 'plan.json', plan90);
    await pipe.confirmPlan(studentId, lessonId, plan90);
    const { report } = await pipe.generate(studentId, lessonId, 'script');
    expect(report.rounds).toBe(2);
    expect(report.passed).toBe(false);
    expect(provider.calls.filter((c) => promptKind(c.prompt) === 'review')).toHaveLength(3);
  });

  it('applies a tutor instruction as a revision', async () => {
    const provider = new FakeProvider((spec) => (promptKind(spec.prompt) === 'review' ? review(5) : promptKind(spec.prompt) === 'revise' ? { ...worksheet, meta: { ...worksheet.meta, title: 'Easier practice' } } : worksheet));
    const pipe = new LessonPipeline({ ...base(), provider });
    await ws.writeLessonFile(studentId, lessonId, 'plan.json', plan90);
    await pipe.generate(studentId, lessonId, 'worksheet', { force: true });
    const { doc } = await pipe.revise(studentId, lessonId, 'worksheet', 'Make the passage easier');
    expect(doc.kind === 'worksheet' && doc.meta.title).toBe('Easier practice');
    expect(provider.calls.at(-2)!.prompt).toContain("The tutor's instruction (highest priority)\nMake the passage easier");
  });
});

const tex = await detectSystemTex({ skipPackageCheck: true });

describe.skipIf(!tex)('LessonPipeline with LaTeX', () => {
  it('compiles during QA and exports every edition', async () => {
    const provider = new FakeProvider((spec) => {
      const k = promptKind(spec.prompt);
      return k === 'review' ? review(5) : DOCS[k as keyof typeof DOCS];
    });
    const engine = new TexEngine();
    const pipe = new LessonPipeline({ ...base(), provider, tex: engine });
    await ws.writeLessonFile(studentId, lessonId, 'plan.json', plan90);
    await pipe.confirmPlan(studentId, lessonId, plan90);
    const steps: string[] = [];
    const p2 = new LessonPipeline({ ...base(), provider, tex: engine, onEvent: (e) => e.type === 'step' && steps.push(e.step) });
    const { report } = await p2.generate(studentId, lessonId, 'worksheet');
    expect(steps).toContain('compile');
    expect(report.checks.filter((c) => c.id === 'compile')).toEqual([]);
    for (const mode of ['student', 'teacher', 'key'] as const) {
      const r = await pipe.exportPdf(studentId, lessonId, 'worksheet', mode);
      expect(r.ok, r.errors.map((e) => e.message).join('; ')).toBe(true);
      expect(existsSync(r.pdfPath!)).toBe(true);
    }
    await pipe.generate(studentId, lessonId, 'deck');
    const d = await pipe.exportPdf(studentId, lessonId, 'deck', 'student', 'tutorbook');
    expect(d.pdfPath).toMatch(/deck-student-tutorbook\.pdf$/);
  }, 240_000);
});

describe('writing review', () => {
  it('locates quotes tolerantly and validates reviews', () => {
    expect(locate(essay, 'Many people which are poor')).not.toBeNull();
    expect(locate(essay, 'education  is most important')).not.toBeNull();
    expect(locate(essay, 'not in the essay at all')).toBeNull();
    expect(countWords("It's a well-known fact, isn't it?")).toBe(6);
    const anchored = writingReview.annotations.map((a, index) => ({ index, ...a, start: 0, end: 1 }));
    expect(validateReview(writingReview, 'task2', anchored)).toEqual([]);
    const bad = { ...writingReview, criteria: writingReview.criteria.map((c) => (c.id === 'LR' ? { ...c, low: 5.3, high: 7 } : c)) };
    expect(validateReview(bad, 'task1', [{ ...anchored[0]!, code: 'W-XX' }]).join(' ')).toMatch(/TA.*half-band.*wider.*Unknown error codes: W-XX/s);
  });

  it('reviews a pasted essay, anchors annotations, and finalises into the error log and profile', async () => {
    const provider = new FakeProvider(() => writingReview);
    const reviewer = new WritingReviewer({ ws, provider });
    const sub = await ws.createSubmission(studentId, { kind: 'writing-task2', prompt: 'Longer prison sentences reduce crime. Agree?', text: essay, date: '2026-10-26' });
    const stored = await reviewer.review(studentId, sub.id);
    expect(stored.issues).toEqual([]);
    expect(stored.wordCount).toBe(countWords(essay));
    const a1 = stored.annotations[1]!;
    expect(essay.slice(a1.start!, a1.end!)).toBe('Many people which are poor');
    expect(provider.calls[0]!.prompt).toContain('## Essay to review (Writing Task 2');
    expect(provider.calls[0]!.model).toBe('quality');

    await reviewer.finalise(studentId, sub.id, { finalBands: { TR: 5, CC: 5.5, LR: 6, GRA: 5 }, accepted: [0, 1] });
    const errs = (await ws.readErrors(studentId)).items.map((e) => e.code);
    expect(errs).toEqual(expect.arrayContaining(['W-GRA-CONJ', 'W-GRA-REL']));
    expect(errs).not.toContain('W-LR-REP');
    const p = await ws.readProfile(studentId);
    expect(p.ok && p.value.levels.map((l) => l.dimension)).toEqual(expect.arrayContaining(['writing.TR', 'writing.GRA']));
    expect((await ws.readSubmission(studentId, sub.id)).meta.status).toBe('finalised');
  });

  it('requires a confirmed transcription for photographed essays', async () => {
    const provider = new FakeProvider((spec) => {
      expect(spec.attachments?.[0]?.mediaType).toBe('image/jpeg');
      return { text: essay, unsure: ['scare'] };
    });
    const reviewer = new WritingReviewer({ ws, provider });
    const sub = await ws.createSubmission(studentId, { kind: 'writing-task2', image: { name: 'photo.JPG', data: Buffer.from([1, 2, 3]) }, date: '2026-10-26' });
    await expect(reviewer.review(studentId, sub.id)).rejects.toThrow(/Confirm the essay text/);
    const t = await reviewer.transcribe(studentId, sub.id);
    expect(t.unsure).toEqual(['scare']);
    await reviewer.confirmText(studentId, sub.id, t.text);
    const { text, meta } = await ws.readSubmission(studentId, sub.id);
    expect(text).toBe(essay);
    expect(meta.textConfirmed).toBe(true);
    expect(await readFile(path.join(await ws.submissionDir(studentId, sub.id), 'original.jpg'))).toEqual(Buffer.from([1, 2, 3]));
  });
});
