/**
 * Quality evaluation with a real model (appendix A.4). Spends API credit, so it only runs with
 * TUTORDESK_EVAL=1. Results (summary.md, QA reports, PDFs) go to eval-results/<timestamp>/.
 *
 *   TUTORDESK_EVAL=1 OPENROUTER_API_KEY=… pnpm vitest run packages/pipeline/eval
 *
 * Options: TUTORDESK_EVAL_GATEWAY (openrouter|anthropic|openai), TUTORDESK_EVAL_BACKEND=claude-cli,
 * TUTORDESK_EVAL_PERSONAS=P01,P16, TUTORDESK_EVAL_KINDS=handout,worksheet.
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WorkspaceService, type ErrorInstance, type ExamId } from '@tutordesk/core';
import type { ArtifactKind } from '@tutordesk/core/artifacts';
import { ApiProvider, ClaudeCliProvider, DEFAULT_MODELS, type AgentProvider, type ApiGateway } from '@tutordesk/providers';
import { TexEngine, detectSystemTex } from '@tutordesk/tex';
import { LessonPipeline, WritingReviewer, type QaReport } from '../src/index.js';
import { essay } from '../test/fakes.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TEMPLATES = path.join(ROOT, 'workspace-template', 'templates', 'tex');

interface Persona {
  id: string;
  name: string;
  exam: ExamId;
  target: number;
  minutes: number;
  levels: Record<string, number>;
  gloss: 'zh' | 'en-en' | 'none';
  notes: string;
  brief: string;
  errors: Omit<ErrorInstance, 'id' | 'date' | 'status'>[];
}

const PERSONAS: Persona[] = [
  {
    id: 'P01',
    name: 'Mina Park',
    exam: 'ielts-academic',
    target: 6.5,
    minutes: 90,
    levels: { listening: 6, reading: 6, writing: 5, speaking: 5 },
    gloss: 'zh',
    notes: 'High-school year 2, lessons after school so often tired. Exam in three months. Part 2 talk lasted 1:05 with long pauses after 40 seconds.',
    brief: 'Task 2 essay structure: clear position and one idea per paragraph.',
    errors: [
      { code: 'W-TR-POS', excerpt: 'Nowadays, with the development of society, more and more people think crime is a big problem.', source: 'submissions/diagnostic/text.md#E1' },
      { code: 'W-GRA-CONJ', excerpt: 'Although longer prison sentences can scare criminals, but it also has some problems.', source: 'submissions/diagnostic/text.md#E2' },
      { code: 'W-LR-REP', excerpt: 'This is very important for society and very important for people.', source: 'submissions/diagnostic/text.md#E3' },
      { code: 'W-GRA-REL', excerpt: 'Many people which are poor will steal things.', source: 'submissions/diagnostic/text.md#E4' },
      { code: 'W-CC-CONC', excerpt: 'In a word, … but education is most important.', source: 'submissions/diagnostic/text.md#E5' },
      { code: 'W-CC-MECH', excerpt: 'Firstly … Secondly … Thirdly … In a word', source: 'submissions/diagnostic/text.md#E6' },
    ],
  },
  {
    id: 'P02',
    name: 'Daniel Ruiz',
    exam: 'ielts-general',
    target: 5.5,
    minutes: 60,
    levels: { listening: 4.5, reading: 4, writing: 4, speaking: 4.5 },
    gloss: 'en-en',
    notes: 'Adult, works full time, one lesson a week, six months to the exam. Spanish speaker. Needs a General Training letter for migration.',
    brief: '',
    errors: [
      { code: 'W-GRA-ART', excerpt: 'I am writing to complain about the noise from building next door.', source: 'submissions/letter1/text.md' },
      { code: 'W-GRA-SVA', excerpt: 'The workers starts at six in the morning.', source: 'submissions/letter1/text.md' },
      { code: 'W-LR-FORM', excerpt: 'It is very disturb for my family.', source: 'submissions/letter1/text.md' },
    ],
  },
  {
    id: 'P03',
    name: 'Aiko Tanaka',
    exam: 'ielts-academic',
    target: 7.5,
    minutes: 90,
    levels: { listening: 8, reading: 8, writing: 6.5, speaking: 7 },
    gloss: 'none',
    notes: 'Postgraduate applicant. Writing has been 6.5 three times. Strong grammar; ideas stay general.',
    brief: 'Push Task 2 development and precise collocation to band 7+.',
    errors: [
      { code: 'W-TR-DEV', excerpt: 'Technology has many benefits for education, for example it is convenient.', source: 'submissions/mock3/text.md' },
      { code: 'W-LR-COLL', excerpt: 'make a research on this issue', source: 'submissions/mock3/text.md' },
      { code: 'W-CC-MECH', excerpt: 'Moreover, … Furthermore, … In addition, …', source: 'submissions/mock3/text.md' },
    ],
  },
  {
    id: 'P16',
    name: 'Ravi Kumar',
    exam: 'pte-academic',
    target: 79,
    minutes: 60,
    levels: { listening: 74, reading: 70, writing: 72, speaking: 62 },
    gloss: 'none',
    notes: 'Skilled migration to Australia; needs 79 in every skill within two months. Speaking hesitates; spelling slips in dictation.',
    brief: 'Summarize Written Text form rules and Write From Dictation accuracy.',
    errors: [
      { code: 'PTE-FORM-SWT', excerpt: 'Wrote two sentences for SWT (82 words).', source: 'mock/2026-10-10.md' },
      { code: 'PTE-WFD-SPELL', excerpt: '"enviroment", "goverment"', source: 'mock/2026-10-10.md' },
      { code: 'PTE-FLU-HES', excerpt: 'Read Aloud: three pauses over 3 seconds', source: 'mock/2026-10-10.md' },
    ],
  },
];

function provider(): AgentProvider {
  if (process.env.TUTORDESK_EVAL_BACKEND === 'claude-cli') return new ClaudeCliProvider({ auth: 'subscription' });
  const gateway = (process.env.TUTORDESK_EVAL_GATEWAY ?? 'openrouter') as ApiGateway;
  const apiKey =
    process.env.TUTORDESK_API_KEY ??
    { openrouter: process.env.OPENROUTER_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY, 'openai-compatible': undefined }[gateway] ??
    '';
  // TUTORDESK_EVAL_QUALITY_MODEL / _REVIEW_MODEL let two models be compared on the same persona.
  const models = { ...DEFAULT_MODELS[gateway] };
  if (process.env.TUTORDESK_EVAL_QUALITY_MODEL) models.quality = process.env.TUTORDESK_EVAL_QUALITY_MODEL;
  if (process.env.TUTORDESK_EVAL_REVIEW_MODEL) models.balanced = process.env.TUTORDESK_EVAL_REVIEW_MODEL;
  return new ApiProvider({ gateway, apiKey, baseURL: process.env.TUTORDESK_EVAL_BASE_URL, models });
}

const pick = <T extends { id: string }>(all: T[], env?: string) => (env ? all.filter((x) => env.split(',').includes(x.id)) : all);
const KINDS = (process.env.TUTORDESK_EVAL_KINDS?.split(',') as ArtifactKind[] | undefined) ?? ['script', 'handout', 'worksheet', 'deck'];

describe.skipIf(!process.env.TUTORDESK_EVAL)('quality evaluation (real model)', () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(ROOT, 'eval-results', stamp);
  const rows: string[] = [];
  const p = provider();

  it('provider is reachable', async () => {
    const h = await p.healthCheck();
    expect(h.ok, h.detail).toBe(true);
    await mkdir(out, { recursive: true });
  }, 60_000);

  for (const persona of pick(PERSONAS, process.env.TUTORDESK_EVAL_PERSONAS)) {
    it(`${persona.id} ${persona.exam}: plan and materials`, async () => {
      const ws = await WorkspaceService.init(path.join(out, 'workspace'));
      const s = await ws.createStudent({ name: persona.name, exam: persona.exam, targetOverall: persona.target });
      await ws.updateProfile(s.id, (x) => ({
        ...x,
        glossLanguage: persona.gloss,
        delivery: { ...x.delivery, minutesPerSession: persona.minutes },
        levels: Object.entries(persona.levels).map(([dimension, value]) => ({ dimension, value, evidenceRefs: ['diagnostic'], date: '2026-10-20' })),
      }));
      await writeFile(path.join(await ws.studentDir(s.id), 'notes.md'), `# Notes\n\n${persona.notes}\n`);
      for (const [i, e] of persona.errors.entries()) await ws.appendError(s.id, { ...e, id: `${persona.id}-e${i + 1}`, date: '2026-10-20', status: 'open' });
      const lesson = await ws.createLesson(s.id, { date: '2026-10-28', minutes: persona.minutes, topic: '' });

      const tex = (await detectSystemTex({ skipPackageCheck: true })) ? new TexEngine() : undefined;
      const pipe = new LessonPipeline({ ws, provider: p, tex, templateDir: TEMPLATES, studio: { name: 'Eval Studio', monogram: 'EV' }, tutorName: 'Eval Tutor' });
      const { plan, report: planReport } = await pipe.plan(s.id, lesson.id, { brief: persona.brief, outputs: KINDS });
      const reports: QaReport[] = [planReport];
      await pipe.confirmPlan(s.id, lesson.id, plan);
      for (const kind of KINDS) {
        const { report } = await pipe.generate(s.id, lesson.id, kind);
        reports.push(report);
        if (tex) {
          const pdf = await pipe.exportPdf(s.id, lesson.id, kind, kind === 'deck' ? 'student' : 'teacher');
          if (pdf.pdfPath) await copyFile(pdf.pdfPath, path.join(out, `${persona.id}-${kind}.pdf`));
        }
      }
      for (const r of reports) {
        const scores = r.review?.scores.map((x) => x.score) ?? [];
        const min = scores.length ? Math.min(...scores) : '–';
        const mean = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : '–';
        rows.push(`| ${persona.id} | ${r.kind} | ${r.passed ? 'pass' : 'NEEDS TUTOR'} | ${r.rounds} | ${mean} | ${min} | ${r.checks.filter((c) => c.severity === 'warning').length} | ${r.needsTutor.join('; ').slice(0, 120)} | $${r.usd.toFixed(3)} |`);
      }
      await writeFile(path.join(out, `${persona.id}-reports.json`), JSON.stringify(reports, null, 2));
      expect(planReport.checks.filter((c) => c.severity === 'error')).toEqual([]);
      for (const r of reports) expect(r.checks.filter((c) => c.id === 'compile')).toEqual([]);
    }, 1_800_000);
  }

  it('writing review of the golden essay lands near the expected bands', async () => {
    const ws = await WorkspaceService.init(path.join(out, 'workspace'));
    const s = await ws.createStudent({ name: 'Essay Check', exam: 'ielts-academic', targetOverall: 6.5 });
    const sub = await ws.createSubmission(s.id, { kind: 'writing-task2', prompt: 'Some people think that the best way to reduce crime is to give longer prison sentences. To what extent do you agree or disagree?', text: essay, date: '2026-10-26' });
    const stored = await new WritingReviewer({ ws, provider: p }).review(s.id, sub.id);
    await writeFile(path.join(out, 'essay-review.json'), JSON.stringify(stored, null, 2));
    // Examiner-style expectation for this short diagnostic essay (appendix A.1): about band 5.
    const expected: Record<string, number> = { TR: 5, CC: 5, LR: 5.5, GRA: 5 };
    const off = stored.review.criteria.filter((c) => expected[c.id]! < c.low - 0.5 || expected[c.id]! > c.high + 0.5).map((c) => `${c.id} ${c.low}–${c.high}`);
    rows.push(`| essay | review | ${off.length ? `OFF: ${off.join(', ')}` : 'within ±0.5'} | – | – | – | ${stored.issues.length} | ${stored.issues.join('; ').slice(0, 120)} | $${stored.usd.toFixed(3)} |`);
    expect(stored.issues).toEqual([]);
    expect(off).toEqual([]);
  }, 600_000);

  it('writes the summary', async () => {
    const md = `# Evaluation ${stamp}\n\n| Persona | Output | Result | Revisions | Rubric mean | Rubric min | Warnings | Notes | Cost |\n|---|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`;
    await writeFile(path.join(out, 'summary.md'), md);
    console.log(md);
  });
});
