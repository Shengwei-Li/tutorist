import type { z } from 'zod';
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
import type { BeamerThemeName, DocContext, RenderedTex } from '@tutordesk/render';
import type { TexEngine } from '@tutordesk/tex';
import { buildContext, type StudentContext } from './context.js';
import { artifactPrompt, planPrompt, problemsFrom, reviewPrompt, revisePrompt, systemFor } from './prompts.js';
import { rubricPasses } from './rubrics.js';
import { ArtifactStudio, type EditionMode, type QaReport } from './studio.js';

export type PipelineStep = 'context' | 'plan' | 'generate' | 'check' | 'compile' | 'review' | 'revise' | 'save';

export type PipelineEvent =
  | { type: 'step'; step: PipelineStep; kind?: ArtifactKind | 'plan'; status: 'start' | 'done' | 'fail'; message?: string; round?: number }
  | { type: 'agent'; kind: ArtifactKind | 'plan'; event: AgentEvent };

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

export class LessonPipeline {
  private usd = 0;
  readonly studio: ArtifactStudio;

  constructor(private readonly o: PipelineOptions) {
    this.studio = new ArtifactStudio(o);
  }

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

  render(doc: ArtifactDoc, ctx: StudentContext, theme: BeamerThemeName = 'tutorswiss'): RenderedTex {
    return this.studio.render(doc, ctx, theme);
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
    let checks = this.studio.checkPlan(plan, ctx);
    let rounds = 0;
    // Plans are cheap to fix: one deterministic repair round for timing and structure.
    if (checks.some((c) => c.severity === 'error')) {
      rounds = 1;
      this.emit({ type: 'step', step: 'revise', kind: 'plan', status: 'start', round: 1 });
      plan = await this.structured('plan', ctx, studentId, `${ctx.text}\n\n${revisePrompt('plan card', JSON.stringify(plan, null, 2), problemsFrom(checks, []))}`, LessonPlan, this.o.tiers?.plan ?? 'quality');
      checks = this.studio.checkPlan(plan, ctx);
    }
    const report = await this.studio.savePlan(studentId, lessonId, plan, { rounds, checks, usd: this.usd });
    this.emit({ type: 'step', step: 'plan', kind: 'plan', status: 'done' });
    return { plan, report };
  }

  /** The tutor edits and approves the plan card (the human gate before generation). */
  confirmPlan(studentId: string, lessonId: string, plan: LessonPlan): Promise<void> {
    return this.studio.confirmPlan(studentId, lessonId, plan);
  }

  /* ───────────────── artifacts ───────────────── */

  private async qa(kind: ArtifactKind, doc: ArtifactDoc, ctx: StudentContext, round: number, opts: { review?: boolean } = {}) {
    this.emit({ type: 'step', step: 'check', kind, status: 'start', round });
    if (this.o.tex) this.emit({ type: 'step', step: 'compile', kind, status: 'start', round });
    const checks = await this.studio.check(kind, doc, ctx);
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
    const plan = await this.studio.readPlan(studentId, lessonId);
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
    const current = await this.studio.readArtifact(studentId, lessonId, kind);
    if (!current) throw new Error(`No ${kind} yet.`);
    this.emit({ type: 'step', step: 'revise', kind, status: 'start', round: 1 });
    const doc = await this.structured(kind, ctx, studentId, `${ctx.text}\n\n${revisePrompt(kind, JSON.stringify(current, null, 2), [], instruction)}`, schema, this.o.tiers?.generate ?? 'quality');
    const { checks, review } = await this.qa(kind, doc, ctx, 1);
    return this.save(studentId, lessonId, kind, doc, checks, review, 1, `Revise ${kind}: ${instruction.slice(0, 60)}`);
  }

  private async save(studentId: string, lessonId: string, kind: ArtifactKind, doc: ArtifactDoc, checks: QaCheck[], review: RubricReview | undefined, rounds: number, message?: string) {
    const report = await this.studio.saveArtifact(studentId, lessonId, doc, { checks, review, rounds, usd: this.usd, message });
    this.emit({ type: 'step', step: 'save', kind, status: report.passed ? 'done' : 'fail', message: report.needsTutor.join('; ') || undefined });
    return { doc, report };
  }

  /* ───────────────── output ───────────────── */

  /** Compile one edition to lessons/<id>/out/<kind>-<mode>.pdf and return its path. */
  exportPdf(studentId: string, lessonId: string, kind: ArtifactKind, mode: EditionMode, theme?: BeamerThemeName) {
    return this.studio.exportPdf(studentId, lessonId, kind, mode, theme);
  }
}
