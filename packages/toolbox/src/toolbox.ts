import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ProfileChanges, ProposalStore, ProposedLesson, ProposedStudent, StudentProfile, draftProfile, mergeProfile, resolveInside, writeJson, writeFileAtomic, type WorkspaceService } from '@tutordesk/core';
import { ARTIFACT_SCHEMAS, ArtifactKind, LessonPlan, RubricReview, WritingReview, type ArtifactDoc } from '@tutordesk/core/artifacts';
import { ArtifactStudio, buildContext, countWords, examLabel, locate, validateReview, type AnchoredAnnotation, type StoredReview, type StudioOptions } from '@tutordesk/pipeline';
import { BEAMER_THEME_NAMES } from '@tutordesk/render';
import { artifactGuide, examTopic, guideline, GUIDELINE_TOPICS } from './guidelines.js';

export interface ToolboxOptions extends StudioOptions {
  /** Refuse to save artifacts until the tutor approved the plan card (appendix E.4.2). */
  requirePlanApproval?: boolean;
  /** Recorded in git messages and QA reports, e.g. "claude-code". */
  by?: string;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** No workspace writes: safe to run without asking in any permission mode. */
  readOnly: boolean;
  run(args: z.infer<z.ZodObject<S>>): Promise<ToolResult>;
}

function tool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

const ok = (text: string): ToolResult => ({ text });
const fail = (text: string): ToolResult => ({ text, isError: true });

/** Agents sometimes send a JSON document as a string; accept both. */
const JsonDoc = z.union([z.string(), z.record(z.string(), z.unknown())]);

function parseDoc(raw: string | Record<string, unknown>): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new UserError(`The document is not valid JSON: ${(e as Error).message}`);
  }
}

/** An error the agent can fix: reported as a tool error, never as a crash. */
export class UserError extends Error {}

/** Zod issues as short lines with a path the agent can find in its own JSON. */
export function formatIssues(error: z.ZodError, max = 25): string {
  const lines = error.issues.slice(0, max).map((i) => `- ${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
  if (error.issues.length > max) lines.push(`- …and ${error.issues.length - max} more`);
  return lines.join('\n');
}

function checksText(checks: { severity: string; message: string; nodeId?: string }[]): string {
  if (!checks.length) return 'No problems found.';
  return checks.map((c) => `- [${c.severity}] ${c.message}${c.nodeId ? ` (node ${c.nodeId})` : ''}`).join('\n');
}

const Note = z.string().max(1000).optional().describe('One or two sentences for the tutor: why, or what you assumed');
const PROPOSED = 'Proposed. Nothing changes until the tutor confirms the card in TutorDesk. Tell the tutor in one or two lines what you proposed and anything you assumed, then stop';

/** A profile the proposal would produce, checked as a whole: the problems as one line, or null. */
function draftCheck(build: () => unknown): string | null {
  try {
    build();
    return null;
  } catch (e) {
    return e instanceof z.ZodError ? formatIssues(e).replace(/\n/g, '; ') : (e as Error).message;
  }
}

const StudentId = z.string().describe('Student folder id, e.g. "li-wei-ielts" (see list_students)');
const LessonIdArg = z.string().describe('Lesson id, e.g. "2026-10-28-L04" (see list_lessons)');
const KindArg = ArtifactKind.describe('handout | worksheet | script | deck');

/**
 * The TutorDesk teaching toolbox (appendix E.4). Transport-neutral: the MCP server and the API
 * session both expose these same definitions. Gates the tutor owns (approving plans, final bands,
 * the error log) deliberately have no tool.
 */
export class Toolbox {
  readonly studio: ArtifactStudio;
  readonly proposals: ProposalStore;

  constructor(private readonly o: ToolboxOptions) {
    this.studio = new ArtifactStudio(o);
    this.proposals = new ProposalStore(o.ws.root);
  }

  private get ws(): WorkspaceService {
    return this.o.ws;
  }

  private async assertStudent(studentId: string) {
    const p = await this.ws.readProfile(studentId).catch(() => null);
    if (!p || (!p.ok && p.issues.some((i) => i.includes('ENOENT')))) throw new UserError(`No student "${studentId}". Call list_students to see the ids.`);
    if (!p.ok) throw new UserError(`profile.json of ${studentId} is invalid: ${p.issues.join('; ')}. Ask the tutor to fix it.`);
    return p.value;
  }

  private async assertLesson(studentId: string, lessonId: string) {
    await this.assertStudent(studentId);
    try {
      return await this.ws.readLesson(studentId, lessonId);
    } catch {
      throw new UserError(`No lesson "${lessonId}" for ${studentId}. Call list_lessons to see the ids.`);
    }
  }

  definitions(): ToolDef[] {
    return [
      tool({
        name: 'list_students',
        title: 'List students',
        description: 'All students in this workspace with exam, target, lesson count and essays waiting for review.',
        input: {},
        readOnly: true,
        run: async () => {
          const rows: string[] = [];
          for (const s of await this.ws.listStudents()) {
            if (!s.ok) {
              rows.push(`- ${s.id}: profile invalid (${s.issues[0] ?? 'unknown'})`);
              continue;
            }
            const p = s.profile;
            const lessons = await this.ws.listLessons(p.id);
            const subs = await this.ws.listSubmissions(p.id);
            const waiting = subs.filter((x) => x.status !== 'finalised').length;
            const last = lessons.at(-1);
            rows.push(`- ${p.id}: ${p.name}, ${examLabel(p.goal.exam)} target ${p.goal.targetOverall}; ${lessons.length} lessons${last ? ` (latest ${last.id}${last.topic ? ` "${last.topic}"` : ''})` : ''}; ${waiting} essays not finalised`);
          }
          return ok(rows.length ? rows.join('\n') : 'No students yet. The tutor adds students in TutorDesk.');
        },
      }),

      tool({
        name: 'get_student_context',
        title: 'Read student context',
        description:
          'Everything known about one student: profile, tutor notes, open errors with quotes, recent writing reviews, previous lessons and, with lessonId, this lesson and its materials. Read this before planning, writing or reviewing anything.',
        input: { studentId: StudentId, lessonId: LessonIdArg.optional() },
        readOnly: true,
        run: async ({ studentId, lessonId }) => {
          const p = await this.assertStudent(studentId);
          if (lessonId) await this.assertLesson(studentId, lessonId);
          const ctx = await buildContext(this.ws, studentId, lessonId);
          return ok(`${ctx.text}\n\n(Exam facts: get_guidelines topic "${examTopic(p.goal.exam)}". Error codes: "error-codes".)`);
        },
      }),

      tool({
        name: 'list_lessons',
        title: 'List lessons',
        description: 'Lessons of one student, oldest first, with status and whether the plan card is approved.',
        input: { studentId: StudentId },
        readOnly: true,
        run: async ({ studentId }) => {
          await this.assertStudent(studentId);
          const lessons = await this.ws.listLessons(studentId);
          if (!lessons.length) return ok('No lessons yet. Use create_lesson.');
          return ok(lessons.map((l) => `- ${l.id}: L${l.number} ${l.date}, ${l.minutes} min, ${l.status}${l.topic ? `, "${l.topic}"` : ''}, plan ${l.planConfirmed ? 'approved' : 'not approved'}`).join('\n'));
        },
      }),

      tool({
        name: 'get_lesson',
        title: 'Read lesson',
        description: 'One lesson: details, the plan card and the status of each artifact (saved or not, checks passed or not).',
        input: { studentId: StudentId, lessonId: LessonIdArg },
        readOnly: true,
        run: async ({ studentId, lessonId }) => {
          const l = await this.assertLesson(studentId, lessonId);
          const plan = await this.studio.readPlan(studentId, lessonId);
          const parts = [
            `Lesson ${l.number} (${l.id}) on ${l.date}, ${l.minutes} min, status ${l.status}.${l.topic ? ` Topic: ${l.topic}.` : ''}${l.brief ? `\nTutor's brief: ${l.brief}` : ''}`,
            `Materials: ${l.materials.length ? l.materials.join(', ') : 'none'}`,
            `Plan card: ${plan ? (l.planConfirmed ? 'APPROVED by the tutor' : 'saved, WAITING for tutor approval') : 'none yet'}`,
          ];
          for (const kind of ArtifactKind.options) {
            const rep = await this.studio.readReport(studentId, lessonId, kind);
            parts.push(`- ${kind}: ${rep ? `saved by ${rep.by ?? 'unknown'}, ${rep.passed ? 'passed' : `NOT passed (${rep.needsTutor.length} problems)`}${rep.review ? '' : ', not reviewed'}` : 'not written'}`);
          }
          if (plan) parts.push(`\nPlan card JSON:\n${JSON.stringify(plan, null, 2)}`);
          return ok(parts.join('\n'));
        },
      }),

      tool({
        name: 'create_lesson',
        title: 'Create lesson',
        description: 'Create one lesson right away, when the tutor asks for that lesson now. To schedule several lessons use propose_lessons. Minutes default to the student’s usual lesson length.',
        input: {
          studentId: StudentId,
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD'),
          minutes: z.number().int().min(15).max(240).optional(),
          topic: z.string().max(80).optional(),
          brief: z.string().max(2000).optional().describe("The tutor's own words about what this lesson should do"),
        },
        readOnly: false,
        run: async ({ studentId, date, minutes, topic, brief }) => {
          await this.assertStudent(studentId);
          const l = await this.ws.createLesson(studentId, { date, minutes, topic });
          if (brief) await this.ws.updateLesson(studentId, l.id, (m) => ({ ...m, brief }), `Brief for ${l.id}`);
          return ok(`Created ${l.id} (lesson ${l.number}, ${l.minutes} min).`);
        },
      }),

      tool({
        name: 'propose_student',
        title: 'Propose new student',
        description:
          'When the tutor describes a new student: propose their profile (and, if the tutor gave a schedule, their first lessons). Nothing is created until the tutor confirms the card in TutorDesk. Ask first if the exam, target score or lesson schedule is unclear; leave other unknown fields out rather than guessing.',
        input: { student: ProposedStudent, lessons: z.array(ProposedLesson).max(30).optional(), note: Note },
        readOnly: false,
        run: async ({ student, lessons, note }) => {
          const parsed = ProposedStudent.safeParse(student);
          if (!parsed.success) return fail(`Not proposed:\n${formatIssues(parsed.error)}`);
          const check = draftCheck(() => draftProfile(parsed.data));
          if (check) return fail(`Not proposed: ${check}`);
          const p = await this.proposals.create({ kind: 'student', student: parsed.data, lessons: lessons ?? [], note, by: this.o.by });
          const twins = (await this.ws.listStudents()).filter((s) => s.ok && s.profile.name.trim().toLowerCase() === parsed.data.name.trim().toLowerCase());
          return ok(
            `${PROPOSED} (proposal ${p.id}: new student ${parsed.data.name}${lessons?.length ? ` with ${lessons.length} lessons` : ''}).${twins.length ? `\nNote: a student named ${parsed.data.name} already exists (${twins.map((s) => (s.ok ? s.profile.id : s.id)).join(', ')}); mention it to the tutor.` : ''}`,
          );
        },
      }),

      tool({
        name: 'propose_profile_update',
        title: 'Propose profile changes',
        description:
          "Propose changes to a student's profile from what the tutor said or from evidence (scores, essays, notes). Send only the fields that change. The tutor sees each change on a card and confirms it in TutorDesk.",
        input: { studentId: StudentId, changes: ProfileChanges, note: Note },
        readOnly: false,
        run: async ({ studentId, changes, note }) => {
          const cur = await this.assertStudent(studentId);
          const parsed = ProfileChanges.safeParse(changes);
          if (!parsed.success) return fail(`Not proposed:\n${formatIssues(parsed.error)}`);
          if (!Object.keys(parsed.data).length) return fail('Not proposed: no changes given.');
          const check = draftCheck(() => StudentProfile.parse(mergeProfile(cur, parsed.data)));
          if (check) return fail(`Not proposed: ${check}`);
          const p = await this.proposals.create({ kind: 'profile', studentId, changes: parsed.data, note, by: this.o.by });
          return ok(`${PROPOSED} (proposal ${p.id}: ${Object.keys(parsed.data).join(', ')}).`);
        },
      }),

      tool({
        name: 'propose_lessons',
        title: 'Propose lessons',
        description:
          "Schedule one or more lessons for a student, e.g. from the tutor's weekly timetable up to the exam. Dates are YYYY-MM-DD; work them out from today's date and the student's schedule. The tutor confirms (and can untick lessons) in TutorDesk.",
        input: { studentId: StudentId, lessons: z.array(ProposedLesson).min(1).max(30), note: Note },
        readOnly: false,
        run: async ({ studentId, lessons, note }) => {
          await this.assertStudent(studentId);
          const taken = new Set((await this.ws.listLessons(studentId)).map((l) => l.date));
          const clash = lessons.filter((l) => taken.has(l.date)).map((l) => l.date);
          const p = await this.proposals.create({ kind: 'lessons', studentId, lessons, note, by: this.o.by });
          return ok(`${PROPOSED} (proposal ${p.id}: ${lessons.length} lessons, ${lessons[0]!.date}${lessons.length > 1 ? ` to ${lessons.at(-1)!.date}` : ''}).${clash.length ? `\nNote: there are already lessons on ${clash.join(', ')}; mention it to the tutor.` : ''}`);
        },
      }),

      tool({
        name: 'get_guidelines',
        title: 'Read guidelines',
        description: `TutorDesk's teaching knowledge. Topics: ${GUIDELINE_TOPICS.join(', ')}. Exam facts must come from "ielts" or "pte", never from memory.`,
        input: { topic: z.enum(GUIDELINE_TOPICS) },
        readOnly: true,
        run: async ({ topic }) => ok(guideline(topic)),
      }),

      tool({
        name: 'get_artifact_schema',
        title: 'Read artifact format',
        description: 'JSON Schema, writing rules, markup and review rubric for a plan card, artifact or writing review. Read it before writing that document.',
        input: { kind: z.enum(['plan', 'handout', 'worksheet', 'script', 'deck', 'writing-review']) },
        readOnly: true,
        run: async ({ kind }) => {
          const schema = kind === 'plan' ? LessonPlan : kind === 'writing-review' ? WritingReview : ARTIFACT_SCHEMAS[kind];
          const rules = kind === 'plan' ? guideline('plan') : kind === 'writing-review' ? guideline('writing-review') : artifactGuide(kind);
          return ok(`${rules}\n\nJSON Schema:\n${JSON.stringify(z.toJSONSchema(schema, { io: 'input' }))}`);
        },
      }),

      tool({
        name: 'save_plan',
        title: 'Save plan card',
        description:
          'Validate and save the plan card for a lesson. It is saved as a proposal: the tutor must approve it in TutorDesk before any artifact can be saved. After saving, stop and tell the tutor it is ready for review.',
        input: { studentId: StudentId, lessonId: LessonIdArg, plan: JsonDoc.describe('The plan card (see get_artifact_schema "plan")') },
        readOnly: false,
        run: async ({ studentId, lessonId, plan }) => {
          await this.assertLesson(studentId, lessonId);
          const parsed = LessonPlan.safeParse(parseDoc(plan));
          if (!parsed.success) return fail(`Not saved: the plan card does not match the format.\n${formatIssues(parsed.error)}`);
          const ctx = await buildContext(this.ws, studentId, lessonId);
          const checks = this.studio.checkPlan(parsed.data, ctx);
          const report = await this.studio.savePlan(studentId, lessonId, parsed.data, { rounds: 0, checks, usd: 0, by: this.o.by });
          return ok(
            `Saved plan card for ${lessonId}; it now waits for the tutor's approval.\nChecks: ${report.passed ? 'passed' : 'NOT passed'}\n${checksText(checks)}${report.passed ? '' : '\nFix the errors and save again before asking for approval.'}`,
          );
        },
      }),

      tool({
        name: 'get_artifact',
        title: 'Read artifact',
        description: 'The saved JSON of one artifact and its latest check results. Read it before revising.',
        input: { studentId: StudentId, lessonId: LessonIdArg, kind: KindArg },
        readOnly: true,
        run: async ({ studentId, lessonId, kind }) => {
          await this.assertLesson(studentId, lessonId);
          const doc = await this.studio.readArtifact(studentId, lessonId, kind);
          if (!doc) return fail(`No ${kind} saved for ${lessonId} yet.`);
          const rep = await this.studio.readReport(studentId, lessonId, kind);
          const review = rep?.review ? `\nReview: ${rep.review.scores.map((s) => `${s.criterion} ${s.score}${s.score < 4 && s.fix ? ` (fix: ${s.fix})` : ''}`).join('; ')}` : '';
          return ok(`${JSON.stringify(doc, null, 2)}\n\nLatest checks:\n${checksText(rep?.checks ?? [])}${review}`);
        },
      }),

      tool({
        name: 'save_artifact',
        title: 'Save artifact',
        description:
          'Validate, check, typeset and save a handout, worksheet, script or deck. Returns every problem found (format, content rules, LaTeX errors, slide overflow). A document with errors is saved as a draft marked "not passed": fix the problems and save again until it passes.',
        input: { studentId: StudentId, lessonId: LessonIdArg, kind: KindArg, doc: JsonDoc.describe('The complete document (see get_artifact_schema)') },
        readOnly: false,
        run: async ({ studentId, lessonId, kind, doc }) => {
          const lesson = await this.assertLesson(studentId, lessonId);
          if (this.o.requirePlanApproval !== false && !lesson.planConfirmed) {
            return fail(`Not saved: the tutor has not approved the plan card for ${lessonId} yet. Ask the tutor to approve it in TutorDesk, then try again.`);
          }
          const raw = parseDoc(doc);
          if (raw && typeof raw === 'object' && !('kind' in raw)) (raw as Record<string, unknown>).kind = kind;
          const parsed = (ARTIFACT_SCHEMAS[kind] as z.ZodType<ArtifactDoc>).safeParse(raw);
          if (!parsed.success) return fail(`Not saved: the ${kind} does not match the format.\n${formatIssues(parsed.error)}`);
          if (parsed.data.kind !== kind) return fail(`Not saved: the document says kind "${parsed.data.kind}" but kind "${kind}" was given.`);
          const ctx = await buildContext(this.ws, studentId, lessonId);
          const checks = await this.studio.check(kind, parsed.data, ctx);
          const report = await this.studio.saveArtifact(studentId, lessonId, parsed.data, { checks, rounds: 0, usd: 0, by: this.o.by });
          return ok(
            report.passed
              ? `Saved ${kind} for ${lessonId}. All checks passed.${checks.length ? `\nWarnings:\n${checksText(checks)}` : ''}`
              : `Saved ${kind} for ${lessonId} as a draft: NOT passed. Fix these and save again:\n${checksText(checks)}`,
          );
        },
      }),

      tool({
        name: 'save_review_scores',
        title: 'Save rubric review',
        description:
          'For an independent reviewer only: score a saved artifact against its rubric (get_artifact_schema shows it). Quote the document as evidence and give a concrete fix for every score below 5.',
        input: { studentId: StudentId, lessonId: LessonIdArg, kind: KindArg, review: JsonDoc.describe('{ scores: [{ criterion, evidence, score 1–5, fix }], overall }') },
        readOnly: false,
        run: async ({ studentId, lessonId, kind, review }) => {
          await this.assertLesson(studentId, lessonId);
          const parsed = RubricReview.safeParse(parseDoc(review));
          if (!parsed.success) return fail(`Not saved: the review does not match the format.\n${formatIssues(parsed.error)}`);
          const report = await this.studio.saveReview(studentId, lessonId, kind, parsed.data, this.o.by);
          return ok(`Saved review of ${kind}: ${report.passed ? 'passes' : `does not pass${report.needsTutor.length ? ` (${report.needsTutor.join('; ')})` : ''}`}.`);
        },
      }),

      tool({
        name: 'export_pdf',
        title: 'Export PDF',
        description: 'Typeset a saved artifact to PDF in the lesson’s out/ folder. Editions: student, teacher (with notes), key (answers).',
        input: {
          studentId: StudentId,
          lessonId: LessonIdArg,
          kind: KindArg,
          edition: z.enum(['student', 'teacher', 'key']).default('student'),
          theme: z.enum(BEAMER_THEME_NAMES).optional().describe('Deck theme; default tutorswiss'),
        },
        readOnly: false,
        run: async ({ studentId, lessonId, kind, edition, theme }) => {
          await this.assertLesson(studentId, lessonId);
          const r = await this.studio.exportPdf(studentId, lessonId, kind, edition ?? 'student', theme);
          if (!r.ok) return fail(`PDF failed:\n${checksText(r.errors.filter((e) => e.severity === 'error'))}`);
          return ok(`PDF written: ${path.relative(this.ws.root, r.pdfPath!).replace(/\\/g, '/')} (${Math.round(r.durationMs / 100) / 10} s).`);
        },
      }),

      tool({
        name: 'list_submissions',
        title: 'List essays',
        description: 'Essays a student handed in, newest first, with status (new, reviewed, finalised by the tutor).',
        input: { studentId: StudentId },
        readOnly: true,
        run: async ({ studentId }) => {
          await this.assertStudent(studentId);
          const subs = await this.ws.listSubmissions(studentId);
          if (!subs.length) return ok('No essays yet.');
          return ok(subs.map((s) => `- ${s.id}: ${s.kind}, ${s.status}${s.textConfirmed ? '' : ', text NOT confirmed'}${s.source === 'image' ? `, photo ${s.original}` : ''}`).join('\n'));
        },
      }),

      tool({
        name: 'get_submission',
        title: 'Read essay',
        description: 'One essay: question, text, word count, and the path of the original photo if there is one (open it with your file reader).',
        input: { studentId: StudentId, submissionId: z.string() },
        readOnly: true,
        run: async ({ studentId, submissionId }) => {
          await this.assertStudent(studentId);
          const { meta, text, dir } = await this.ws.readSubmission(studentId, submissionId).catch(() => {
            throw new UserError(`No essay "${submissionId}". Call list_submissions.`);
          });
          const photo = meta.original ? path.relative(this.ws.root, path.join(dir, meta.original)).replace(/\\/g, '/') : null;
          return ok(
            `${meta.kind}, status ${meta.status}, text ${meta.textConfirmed ? 'confirmed by the tutor' : 'NOT confirmed yet'}.\nQuestion: ${meta.prompt || '(not given)'}${photo ? `\nPhoto: ${photo}` : ''}\nWords: ${countWords(text)}\n\n${text || '(no text yet: transcribe the photo with save_transcription)'}`,
          );
        },
      }),

      tool({
        name: 'save_transcription',
        title: 'Save essay transcription',
        description: 'Save your transcription of a photographed essay, exactly as the student wrote it (keep their mistakes; mark unreadable words [?]). The tutor confirms it before it can be reviewed.',
        input: { studentId: StudentId, submissionId: z.string(), text: z.string().min(1), unsure: z.array(z.string()).max(30).default([]) },
        readOnly: false,
        run: async ({ studentId, submissionId, text, unsure }) => {
          await this.assertStudent(studentId);
          const { meta } = await this.ws.readSubmission(studentId, submissionId);
          if (meta.textConfirmed) return fail('Not saved: the tutor already confirmed this text.');
          await this.ws.updateSubmission(studentId, submissionId, { text, meta: (m) => ({ ...m, textConfirmed: false }) }, `Transcribe ${submissionId}${this.o.by ? ` (${this.o.by})` : ''}`);
          return ok(`Saved ${countWords(text)} words. Ask the tutor to check and confirm the text${unsure?.length ? `, especially: ${unsure.join(', ')}` : ''}.`);
        },
      }),

      tool({
        name: 'save_writing_review',
        title: 'Save essay review',
        description:
          'Validate and save your review of a confirmed essay: band ranges, annotations whose quotes are exact copies from the essay, error codes, top issues, a rewrite. Saved for the tutor, who sets final bands and decides which annotations enter the error log.',
        input: { studentId: StudentId, submissionId: z.string(), review: JsonDoc.describe('See get_artifact_schema "writing-review"') },
        readOnly: false,
        run: async ({ studentId, submissionId, review }) => {
          await this.assertStudent(studentId);
          const { meta, text, dir } = await this.ws.readSubmission(studentId, submissionId);
          if (!meta.textConfirmed) return fail('Not saved: the tutor has not confirmed the essay text yet.');
          if (meta.status === 'finalised') return fail('Not saved: the tutor already finalised this review.');
          const parsed = WritingReview.safeParse(parseDoc(review));
          if (!parsed.success) return fail(`Not saved: the review does not match the format.\n${formatIssues(parsed.error)}`);
          const annotations: AnchoredAnnotation[] = parsed.data.annotations.map((a, index) => {
            const hit = locate(text, a.quote);
            return { index, ...a, start: hit?.[0] ?? null, end: hit?.[1] ?? null };
          });
          const issues = validateReview(parsed.data, meta.kind === 'writing-task1' ? 'task1' : 'task2', annotations);
          const lost = annotations.filter((a) => a.start === null).map((a) => `#${a.index} "${a.quote.slice(0, 50)}"`);
          if (issues.length) return fail(`Not saved. Fix these:\n${issues.map((i) => `- ${i}`).join('\n')}${lost.length ? `\nQuotes not found in the essay: ${lost.join('; ')}` : ''}`);
          const stored: StoredReview = { review: parsed.data, annotations, wordCount: countWords(text), issues, usd: 0, model: this.o.by, at: new Date().toISOString() };
          await writeJson(path.join(dir, 'review.json'), stored);
          await this.ws.updateSubmission(studentId, submissionId, { meta: (m) => ({ ...m, status: 'reviewed' }) }, `Review ${submissionId}${this.o.by ? ` (${this.o.by})` : ''}`);
          return ok(`Saved review of ${submissionId} (${annotations.length} annotations${lost.length ? `, ${lost.length} quotes not located` : ''}). The tutor will set final bands.`);
        },
      }),

      tool({
        name: 'save_material_text',
        title: 'Save material text',
        description:
          'Save text you extracted from a PDF or photo the tutor uploaded (passages, questions, answer keys) as a student material, optionally attached to a lesson. Read get_guidelines "materials" first.',
        input: {
          studentId: StudentId,
          name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/).describe('File name without extension, e.g. "cam19-test2-reading"'),
          text: z.string().min(1),
          source: z.string().describe('Where it came from, e.g. "materials/raw/cam19.pdf pages 24–27"'),
          lessonId: LessonIdArg.optional(),
        },
        readOnly: false,
        run: async ({ studentId, name, text, source, lessonId }) => {
          await this.assertStudent(studentId);
          if (lessonId) await this.assertLesson(studentId, lessonId);
          const dir = await this.ws.studentDir(studentId);
          const rel = `materials/parsed/${name}.md`;
          const file = await resolveInside(dir, rel);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFileAtomic(file, `<!-- source: ${source.replace(/-->/g, '')} -->\n\n${text.trim()}\n`);
          if (lessonId) await this.ws.updateLesson(studentId, lessonId, (l) => ({ ...l, materials: l.materials.includes(rel) ? l.materials : [...l.materials, rel] }));
          await this.ws.commit(studentId, `Add material ${name}${this.o.by ? ` (${this.o.by})` : ''}`);
          return ok(`Saved ${rel}${lessonId ? ` and attached it to ${lessonId}` : ''}.`);
        },
      }),

      tool({
        name: 'append_note',
        title: 'Add tutor note',
        description: "Append a dated note to the student's notes.md (for example an analysis the tutor asked for). Never rewrites existing notes.",
        input: { studentId: StudentId, text: z.string().min(1).max(4000) },
        readOnly: false,
        run: async ({ studentId, text }) => {
          await this.assertStudent(studentId);
          const file = path.join(await this.ws.studentDir(studentId), 'notes.md');
          const existing = await readFile(file, 'utf8').catch(() => '');
          const head = `\n## ${new Date().toISOString().slice(0, 10)}${this.o.by ? ` · ${this.o.by}` : ''}\n\n`;
          await appendFile(file, `${existing.endsWith('\n') || !existing ? '' : '\n'}${head}${text.trim()}\n`, 'utf8');
          await this.ws.commit(studentId, `Note${this.o.by ? ` (${this.o.by})` : ''}`);
          return ok('Note added to notes.md.');
        },
      }),
    ];
  }

  /** Run one tool by name with untrusted arguments; never throws. */
  async call(name: string, args: unknown): Promise<ToolResult> {
    const def = this.definitions().find((d) => d.name === name);
    if (!def) return fail(`Unknown tool ${name}`);
    const parsed = z.object(def.input).safeParse(args ?? {});
    if (!parsed.success) return fail(`Invalid arguments:\n${formatIssues(parsed.error)}`);
    try {
      return await def.run(parsed.data);
    } catch (e) {
      if (e instanceof UserError) return fail(e.message);
      return fail(`TutorDesk error: ${(e as Error).message}`);
    }
  }
}
