import path from 'node:path';
import { z } from 'zod';
import type { WorkspaceService } from '@tutordesk/core';
import {
  ARTIFACT_SCHEMAS,
  LessonPlan,
  RubricReview,
  type ArtifactDoc,
  type ArtifactKind,
  type QaCheck,
} from '@tutordesk/core/artifacts';
import { runStructured, type AgentEvent, type AgentProvider, type ModelTier } from '@tutordesk/providers';
import { BEAMER_THEME_NAMES, renderDeck, renderHandout, renderScript, renderWorksheet, type BeamerThemeName, type DocContext, type RenderedTex } from '@tutordesk/render';
import type { TexEngine } from '@tutordesk/tex';
import { checkArtifact, checkPlan } from './checks.js';
import { buildContext, type StudentContext } from './context.js';
import { examLabel } from './knowledge.js';
import { artifactPrompt, planPrompt, problemsFrom, reviewPrompt, revisePrompt, systemFor } from './prompts.js';
import { hardGateFailures, rubricPasses } from './rubrics.js';

export type PipelineStep = 'context' | 'plan' | 'generate' | 'check' | 'compile' | 'review' | 'revise' | 'save';

export type PipelineEvent =
  | { type: 'step'; step: PipelineStep; kind?: ArtifactKind | 'plan'; status: 'start' | 'done' | 'fail'; message?: string; round?: number }
  | { type: 'agent'; kind: ArtifactKind | 'plan'; event: AgentEvent };

export interface QaReport {
  kind: ArtifactKind | 'plan';
  rounds: number;
  checks: QaCheck[];
  review?: RubricReview;
  passed: boolean;
  /** Hard gates that failed or problems that survived revision: the tutor must look. */
  needsTutor: string[];
  usd: number;
  at: string;
}

export interface PipelineOptions {
  ws: WorkspaceService;
  provider: AgentProvider;
  /** Optional: compile during QA so LaTeX errors are fixed before the tutor sees them. */
  tex?: TexEngine;
  templateDir: string;
  studio: DocContext['studio'];
  tutorName: string;
  /** Model tier per step (SPEC §7.7). */
  tiers?: Partial<Record<'plan' | 'generate' | 'review', ModelTier>>;
  /** LLM review + revision rounds (0 disables the judge). */
  maxRevisions?: number;
  review?: boolean;
  onEvent?: (e: PipelineEvent) => void;
  signal?: AbortSignal;
}

export type EditionMode = 'student' | 'teacher' | 'key';

const OUTPUT_FILE: Record<ArtifactKind, string> = { handout: 'handout.json', worksheet: 'worksheet.json', script: 'script.json', deck: 'deck.json' };

function displayDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export class LessonPipeline {
  private usd = 0;

  constructor(private readonly o: PipelineOptions) {}

  private emit(e: PipelineEvent) {
    this.o.onEvent?.(e);
  }

  private async structured<S extends z.ZodType>(
    kind: ArtifactKind | 'plan',
    ctx: StudentContext,
    studentId: string,
    prompt: string,
    schema: S,
    tier: ModelTier,
  ): Promise<z.infer<S>> {
    const dir = await this.o.ws.studentDir(studentId);
    const r = await runStructured(
      this.o.provider,
      {
        taskType: 'extract',
        workspaceRoot: dir,
        prompt,
        systemAppend: systemFor(ctx.profile.goal.exam),
        model: tier,
        permissions: { writableGlobs: [], readableGlobs: ['**'], allowShell: false, allowNetwork: false },
      },
      schema,
      { signal: this.o.signal, onEvent: (event) => this.emit({ type: 'agent', kind, event }) },
    );
    this.usd += r.usd;
    if (!r.ok) throw new Error(`${kind}: ${r.error}${r.issues ? ` (${r.issues.slice(0, 5).join('; ')})` : ''}`);
    return r.value;
  }

  private docContext(ctx: StudentContext): DocContext {
    const l = ctx.lesson!;
    return {
      studio: this.o.studio,
      student: ctx.profile.name,
      lessonNumber: l.number,
      lessonDate: displayDate(l.date),
      examLabel: examLabel(ctx.profile.goal.exam) + (l.topic ? ` · ${l.topic}` : ''),
    };
  }

  render(doc: ArtifactDoc, ctx: StudentContext, theme: BeamerThemeName = 'tutorswiss'): RenderedTex {
    const dc = this.docContext(ctx);
    switch (doc.kind) {
      case 'handout':
        return renderHandout(doc, dc);
      case 'worksheet':
        return renderWorksheet(doc, dc);
      case 'script':
        return renderScript(doc, dc);
      case 'deck':
        return renderDeck(doc, { theme: BEAMER_THEME_NAMES.includes(theme) ? theme : 'tutorswiss', learner: ctx.profile.name, tutor: this.o.tutorName, lessonNumber: dc.lessonNumber });
    }
  }

  /* ───────────────── plan ───────────────── */

  async plan(studentId: string, lessonId: string, opts: { brief?: string; outputs?: ArtifactKind[] } = {}): Promise<{ plan: LessonPlan; report: QaReport }> {
    this.usd = 0;
    this.emit({ type: 'step', step: 'context', status: 'start' });
    const ctx = await buildContext(this.o.ws, studentId, lessonId);
    const lesson = ctx.lesson!;
    const outputs = opts.outputs ?? ['script', 'handout', 'worksheet', 'deck'];
    if (opts.brief !== undefined) await this.o.ws.updateLesson(studentId, lessonId, (l) => ({ ...l, brief: opts.brief! }));
    this.emit({ type: 'step', step: 'plan', kind: 'plan', status: 'start' });

    let plan = await this.structured('plan', ctx, studentId, planPrompt(ctx.text, { brief: opts.brief ?? lesson.brief, outputs, minutes: lesson.minutes }), LessonPlan, this.o.tiers?.plan ?? 'quality');
    let checks = checkPlan(plan, lesson.minutes, ctx.openErrors.length);
    let rounds = 0;
    // Plans are cheap to fix: one deterministic repair round for timing and structure.
    if (checks.some((c) => c.severity === 'error')) {
      rounds = 1;
      this.emit({ type: 'step', step: 'revise', kind: 'plan', status: 'start', round: 1 });
      plan = await this.structured('plan', ctx, studentId, `${ctx.text}\n\n${revisePrompt('plan card', JSON.stringify(plan, null, 2), problemsFrom(checks, []))}`, LessonPlan, this.o.tiers?.plan ?? 'quality');
      checks = checkPlan(plan, lesson.minutes, ctx.openErrors.length);
    }
    const report: QaReport = {
      kind: 'plan',
      rounds,
      checks,
      passed: !checks.some((c) => c.severity === 'error'),
      needsTutor: checks.filter((c) => c.severity === 'error').map((c) => c.message),
      usd: this.usd,
      at: new Date().toISOString(),
    };
    await this.o.ws.writeLessonFile(studentId, lessonId, 'plan.json', plan);
    await this.o.ws.writeLessonFile(studentId, lessonId, 'qa/plan.json', report);
    await this.o.ws.updateLesson(studentId, lessonId, (l) => ({ ...l, planConfirmed: false, topic: l.topic || plan.title }));
    await this.o.ws.appendRunLog(studentId, lessonId, { step: 'plan', usd: this.usd, passed: report.passed });
    await this.o.ws.commit(studentId, `Plan lesson ${lessonId}`);
    this.emit({ type: 'step', step: 'plan', kind: 'plan', status: 'done' });
    return { plan, report };
  }

  /** The tutor edits and approves the plan card (the human gate before generation). */
  async confirmPlan(studentId: string, lessonId: string, plan: LessonPlan): Promise<void> {
    const parsed = LessonPlan.parse(plan);
    await this.o.ws.writeLessonFile(studentId, lessonId, 'plan.json', parsed);
    await this.o.ws.updateLesson(studentId, lessonId, (l) => ({ ...l, planConfirmed: true }), `Approve plan for ${lessonId}`);
  }

  /* ───────────────── artifacts ───────────────── */

  private async qa(kind: ArtifactKind, doc: ArtifactDoc, ctx: StudentContext, round: number, opts: { review?: boolean } = {}) {
    this.emit({ type: 'step', step: 'check', kind, status: 'start', round });
    const checks = checkArtifact(doc, ctx.lesson!.minutes);
    if (this.o.tex) {
      this.emit({ type: 'step', step: 'compile', kind, status: 'start', round });
      const r = this.render(doc, ctx);
      // Markup the renderer did not consume would print literally on the page.
      if (/\[\[|\\\{\\\{/.test(r.tex)) checks.push({ id: 'leftover-markup', severity: 'error', message: 'Markup ([[…]] or {{…}}) was used in a field that does not support it; write plain text there.' });
      const res = await this.o.tex.compile({ mainTex: r.tex, lineMap: r.lineMap, templateDir: this.o.templateDir, signal: this.o.signal });
      for (const e of res.errors) {
        if (e.severity === 'error') checks.push({ id: 'compile', severity: 'error', message: `LaTeX: ${e.message}${e.context ? ` near "${e.context}"` : ''}`, nodeId: e.nodeId });
        else if (e.severity === 'badbox' && kind === 'deck') {
          // Text running off the bottom of a slide is unusable; a hairline overrun to the side is not.
          const tall = /([\d.]+)pt too high/.exec(e.message);
          const severe = tall !== null && Number(tall[1]) > 5;
          checks.push({ id: 'overflow', severity: severe ? 'error' : 'warning', message: severe ? `A slide overflows at the bottom by ${Math.round(Number(tall![1]))}pt: shorten it or split it into two frames.` : `Content slightly too wide: ${e.message}`, nodeId: e.nodeId });
        }
      }
    }
    let review: RubricReview | undefined;
    if (this.o.review !== false && opts.review !== false) {
      this.emit({ type: 'step', step: 'review', kind, status: 'start', round });
      review = await this.structured(kind, ctx, ctx.profile.id, reviewPrompt(kind, ctx.text, JSON.stringify(doc)), RubricReview, this.o.tiers?.review ?? 'balanced');
    }
    return { checks, review };
  }

  async generate(studentId: string, lessonId: string, kind: ArtifactKind, opts: { force?: boolean } = {}): Promise<{ doc: ArtifactDoc; report: QaReport }> {
    this.usd = 0;
    const ctx = await buildContext(this.o.ws, studentId, lessonId);
    if (!ctx.lesson!.planConfirmed && !opts.force) throw new Error('Approve the plan card before generating materials.');
    const plan = await this.o.ws.readLessonJson(studentId, lessonId, 'plan.json', LessonPlan);
    if (!plan) throw new Error('No plan card yet.');
    const schema = ARTIFACT_SCHEMAS[kind] as z.ZodType<ArtifactDoc>;
    const tier = this.o.tiers?.generate ?? 'quality';

    this.emit({ type: 'step', step: 'generate', kind, status: 'start' });
    let doc = await this.structured(kind, ctx, studentId, artifactPrompt(kind, ctx.text, plan, ctx.lesson!.minutes), schema, tier);
    // One automatic revision by default: most of the gain at half the cost of two (eval, 2026-10-26).
    const maxRounds = this.o.maxRevisions ?? 1;
    let { checks, review } = await this.qa(kind, doc, ctx, 0);
    let rounds = 0;
    const ok = () => !checks.some((c) => c.severity === 'error') && (!review || rubricPasses(review.scores));
    while (!ok() && rounds < maxRounds) {
      rounds++;
      this.emit({ type: 'step', step: 'revise', kind, status: 'start', round: rounds });
      doc = await this.structured(kind, ctx, studentId, `${ctx.text}\n\n${revisePrompt(kind, JSON.stringify(doc, null, 2), problemsFrom(checks, review?.scores ?? []))}`, schema, tier);
      ({ checks, review } = await this.qa(kind, doc, ctx, rounds));
    }
    // Mechanical errors (overflow, length, missing glyphs, compile) leave a document unusable, and fixing
    // them needs no judgement: allow one extra targeted round for those alone, without re-reviewing.
    const mechanical = checks.filter((c) => c.severity === 'error');
    if (mechanical.length && rounds === maxRounds) {
      rounds++;
      this.emit({ type: 'step', step: 'revise', kind, status: 'start', round: rounds });
      const fixed = await this.structured(kind, ctx, studentId, `${ctx.text}\n\n${revisePrompt(kind, JSON.stringify(doc, null, 2), problemsFrom(mechanical, []))}\nChange only what these problems require.`, schema, tier);
      const recheck = await this.qa(kind, fixed, ctx, rounds, { review: false });
      if (recheck.checks.filter((c) => c.severity === 'error').length < mechanical.length) {
        doc = fixed;
        checks = recheck.checks;
      }
    }
    return this.save(studentId, lessonId, kind, doc, checks, review, rounds);
  }

  /** Tutor-directed change, e.g. "make the passage easier" (SPEC §4.3 local rewrite, whole-document form). */
  async revise(studentId: string, lessonId: string, kind: ArtifactKind, instruction: string): Promise<{ doc: ArtifactDoc; report: QaReport }> {
    this.usd = 0;
    const ctx = await buildContext(this.o.ws, studentId, lessonId);
    const schema = ARTIFACT_SCHEMAS[kind] as z.ZodType<ArtifactDoc>;
    const current = await this.o.ws.readLessonJson(studentId, lessonId, OUTPUT_FILE[kind], schema);
    if (!current) throw new Error(`No ${kind} yet.`);
    this.emit({ type: 'step', step: 'revise', kind, status: 'start', round: 1 });
    const doc = await this.structured(kind, ctx, studentId, `${ctx.text}\n\n${revisePrompt(kind, JSON.stringify(current, null, 2), [], instruction)}`, schema, this.o.tiers?.generate ?? 'quality');
    const { checks, review } = await this.qa(kind, doc, ctx, 1);
    return this.save(studentId, lessonId, kind, doc, checks, review, 1, `Revise ${kind}: ${instruction.slice(0, 60)}`);
  }

  private async save(studentId: string, lessonId: string, kind: ArtifactKind, doc: ArtifactDoc, checks: QaCheck[], review: RubricReview | undefined, rounds: number, message?: string) {
    const gates = review ? hardGateFailures(review.scores, kind) : [];
    const report: QaReport = {
      kind,
      rounds,
      checks,
      review,
      passed: !checks.some((c) => c.severity === 'error') && (!review || rubricPasses(review.scores)),
      needsTutor: [...checks.filter((c) => c.severity === 'error').map((c) => c.message), ...gates.map((g) => `Hard gate ${g} failed`)],
      usd: this.usd,
      at: new Date().toISOString(),
    };
    await this.o.ws.writeLessonFile(studentId, lessonId, OUTPUT_FILE[kind], doc);
    await this.o.ws.writeLessonFile(studentId, lessonId, `qa/${kind}.json`, report);
    await this.o.ws.appendRunLog(studentId, lessonId, { step: kind, usd: this.usd, rounds, passed: report.passed });
    await this.o.ws.updateLesson(studentId, lessonId, (l) => ({ ...l, status: l.status === 'planned' ? 'prepared' : l.status }));
    await this.o.ws.commit(studentId, message ?? `Generate ${kind} for ${lessonId}`);
    this.emit({ type: 'step', step: 'save', kind, status: report.passed ? 'done' : 'fail', message: report.needsTutor.join('; ') || undefined });
    return { doc, report };
  }

  /* ───────────────── output ───────────────── */

  /** Compile one edition to lessons/<id>/out/<kind>-<mode>.pdf and return its path. */
  async exportPdf(studentId: string, lessonId: string, kind: ArtifactKind, mode: EditionMode, theme?: BeamerThemeName) {
    if (!this.o.tex) throw new Error('No TeX engine available');
    const ctx = await buildContext(this.o.ws, studentId, lessonId);
    const doc = await this.o.ws.readLessonJson(studentId, lessonId, OUTPUT_FILE[kind], ARTIFACT_SCHEMAS[kind] as z.ZodType<ArtifactDoc>);
    if (!doc) throw new Error(`No ${kind} yet.`);
    const r = this.render(doc, ctx, theme);
    const lessonDir = await this.o.ws.lessonDir(studentId, lessonId);
    const res = await this.o.tex.compileLatest(`${studentId}/${lessonId}/${kind}`, {
      mainTex: r.tex,
      lineMap: r.lineMap,
      templateDir: this.o.templateDir,
      buildDir: path.join(lessonDir, 'build', `${kind}-${mode}`),
      pretex: kind === 'deck' || mode === 'student' ? undefined : `\\def\\TDmode{${mode}}`,
      signal: this.o.signal,
    });
    let pdfPath: string | undefined;
    if (res.ok && res.pdf) pdfPath = await this.o.ws.writeLessonFile(studentId, lessonId, `out/${kind}-${mode}${kind === 'deck' && theme ? `-${theme}` : ''}.pdf`, res.pdf);
    await this.o.ws.writeLessonFile(studentId, lessonId, `out/${kind}.tex`, r.tex);
    return { ok: res.ok, pdfPath, pdf: res.pdf, errors: res.errors, durationMs: res.durationMs };
  }
}
