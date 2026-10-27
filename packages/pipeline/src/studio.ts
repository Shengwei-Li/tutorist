import path from 'node:path';
import { z } from 'zod';
import { readJson, type WorkspaceService } from '@tutordesk/core';
import { ARTIFACT_SCHEMAS, LessonPlan, type ArtifactDoc, type ArtifactKind, type QaCheck, type RubricReview } from '@tutordesk/core/artifacts';
import { BEAMER_THEME_NAMES, renderDeck, renderHandout, renderScript, renderWorksheet, type BeamerThemeName, type DocContext, type RenderedTex } from '@tutordesk/render';
import type { TexEngine } from '@tutordesk/tex';
import { checkArtifact, checkPlan } from './checks.js';
import { buildContext, type StudentContext } from './context.js';
import { examLabel } from './knowledge.js';
import { hardGateFailures, rubricPasses } from './rubrics.js';

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
  /** Who produced this version, e.g. "claude-code" or "api:google/gemini-3.8-flash". */
  by?: string;
}

export type EditionMode = 'student' | 'teacher' | 'key';

export interface StudioOptions {
  ws: WorkspaceService;
  /** Optional: compile during QA so LaTeX errors are caught before the tutor sees them. */
  tex?: TexEngine;
  templateDir: string;
  studio: DocContext['studio'];
  tutorName: string;
  signal?: AbortSignal;
}

export const OUTPUT_FILE: Record<ArtifactKind, string> = { handout: 'handout.json', worksheet: 'worksheet.json', script: 'script.json', deck: 'deck.json' };

function displayDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Everything about lesson artifacts that needs no model: render, check, compile, save, export
 * (appendix E.11 H1). The API pipeline and the agent toolbox both go through here, so a document
 * passes the same gates whoever wrote it.
 */
export class ArtifactStudio {
  constructor(readonly o: StudioOptions) {}

  get ws(): WorkspaceService {
    return this.o.ws;
  }

  docContext(ctx: StudentContext): DocContext {
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

  /** Deterministic checks plus a real compile: the gates no model can talk its way past. */
  async check(kind: ArtifactKind, doc: ArtifactDoc, ctx: StudentContext): Promise<QaCheck[]> {
    const checks = checkArtifact(doc, ctx.lesson!.minutes);
    if (!this.o.tex) return checks;
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
    return checks;
  }

  /* ───────────────── plan ───────────────── */

  checkPlan(plan: LessonPlan, ctx: StudentContext): QaCheck[] {
    return checkPlan(plan, ctx.lesson!.minutes, ctx.openErrors.length);
  }

  /** Save a proposed plan card. It always waits for the tutor's approval afterwards. */
  async savePlan(studentId: string, lessonId: string, plan: LessonPlan, report: Omit<QaReport, 'kind' | 'at' | 'passed' | 'needsTutor'>): Promise<QaReport> {
    const errors = report.checks.filter((c) => c.severity === 'error');
    const full: QaReport = { ...report, kind: 'plan', passed: errors.length === 0, needsTutor: errors.map((c) => c.message), at: new Date().toISOString() };
    await this.o.ws.writeLessonFile(studentId, lessonId, 'plan.json', plan);
    await this.o.ws.writeLessonFile(studentId, lessonId, 'qa/plan.json', full);
    await this.o.ws.updateLesson(studentId, lessonId, (l) => ({ ...l, planConfirmed: false, topic: l.topic || plan.title }));
    await this.o.ws.appendRunLog(studentId, lessonId, { step: 'plan', usd: full.usd, passed: full.passed, by: full.by });
    await this.o.ws.commit(studentId, `Plan lesson ${lessonId}${full.by ? ` (${full.by})` : ''}`);
    return full;
  }

  /** The tutor edits and approves the plan card (the human gate before generation). */
  async confirmPlan(studentId: string, lessonId: string, plan: LessonPlan): Promise<void> {
    const parsed = LessonPlan.parse(plan);
    await this.o.ws.writeLessonFile(studentId, lessonId, 'plan.json', parsed);
    await this.o.ws.updateLesson(studentId, lessonId, (l) => ({ ...l, planConfirmed: true }), `Approve plan for ${lessonId}`);
  }

  readPlan(studentId: string, lessonId: string): Promise<LessonPlan | null> {
    return this.o.ws.readLessonJson(studentId, lessonId, 'plan.json', LessonPlan);
  }

  /* ───────────────── artifacts ───────────────── */

  readArtifact(studentId: string, lessonId: string, kind: ArtifactKind): Promise<ArtifactDoc | null> {
    return this.o.ws.readLessonJson(studentId, lessonId, OUTPUT_FILE[kind], ARTIFACT_SCHEMAS[kind] as z.ZodType<ArtifactDoc>);
  }

  async saveArtifact(
    studentId: string,
    lessonId: string,
    doc: ArtifactDoc,
    o: { checks: QaCheck[]; review?: RubricReview; rounds: number; usd: number; by?: string; message?: string },
  ): Promise<QaReport> {
    const kind = doc.kind;
    const gates = o.review ? hardGateFailures(o.review.scores, kind) : [];
    const report: QaReport = {
      kind,
      rounds: o.rounds,
      checks: o.checks,
      review: o.review,
      passed: !o.checks.some((c) => c.severity === 'error') && (!o.review || rubricPasses(o.review.scores)),
      needsTutor: [...o.checks.filter((c) => c.severity === 'error').map((c) => c.message), ...gates.map((g) => `Hard gate ${g} failed`)],
      usd: o.usd,
      at: new Date().toISOString(),
      by: o.by,
    };
    await this.o.ws.writeLessonFile(studentId, lessonId, OUTPUT_FILE[kind], doc);
    await this.o.ws.writeLessonFile(studentId, lessonId, `qa/${kind}.json`, report);
    await this.o.ws.appendRunLog(studentId, lessonId, { step: kind, usd: o.usd, rounds: o.rounds, passed: report.passed, by: o.by });
    await this.o.ws.updateLesson(studentId, lessonId, (l) => ({ ...l, status: l.status === 'planned' ? 'prepared' : l.status }));
    await this.o.ws.commit(studentId, o.message ?? `Generate ${kind} for ${lessonId}${o.by ? ` (${o.by})` : ''}`);
    return report;
  }

  async readReport(studentId: string, lessonId: string, kind: ArtifactKind | 'plan'): Promise<QaReport | null> {
    const r = await readJson(path.join(await this.o.ws.lessonDir(studentId, lessonId), 'qa', `${kind}.json`), z.any());
    return r.ok ? (r.value as QaReport) : null;
  }

  /** Attach an independent rubric review to the saved artifact's report (appendix E.5). */
  async saveReview(studentId: string, lessonId: string, kind: ArtifactKind, review: RubricReview, by?: string): Promise<QaReport> {
    const prev = await this.readReport(studentId, lessonId, kind);
    if (!prev) throw new Error(`No ${kind} saved yet for ${lessonId}.`);
    const gates = hardGateFailures(review.scores, kind);
    const report: QaReport = {
      ...prev,
      review,
      passed: !prev.checks.some((c) => c.severity === 'error') && rubricPasses(review.scores),
      needsTutor: [...prev.checks.filter((c) => c.severity === 'error').map((c) => c.message), ...gates.map((g) => `Hard gate ${g} failed`)],
      at: new Date().toISOString(),
    };
    await this.o.ws.writeLessonFile(studentId, lessonId, `qa/${kind}.json`, report);
    await this.o.ws.commit(studentId, `Review ${kind} for ${lessonId}${by ? ` (${by})` : ''}`);
    return report;
  }

  /* ───────────────── output ───────────────── */

  /** Compile one edition to lessons/<id>/out/<kind>-<mode>.pdf and return its path. */
  async exportPdf(studentId: string, lessonId: string, kind: ArtifactKind, mode: EditionMode, theme?: BeamerThemeName) {
    if (!this.o.tex) throw new Error('No TeX engine available');
    const ctx = await buildContext(this.o.ws, studentId, lessonId);
    const doc = await this.readArtifact(studentId, lessonId, kind);
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
