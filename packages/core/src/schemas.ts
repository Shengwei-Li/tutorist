import { z } from 'zod';

/** Exams in scope (SPEC §6): IELTS and PTE only. */
export const ExamId = z.enum(['ielts-academic', 'ielts-general', 'pte-academic', 'pte-core']);
export type ExamId = z.infer<typeof ExamId>;

export interface ScoreScale {
  min: number;
  max: number;
  step: number;
  /** Skill dimensions reported on the score sheet. */
  skills: readonly string[];
}

export const SCORE_SCALES: Record<ExamId, ScoreScale> = {
  'ielts-academic': { min: 0, max: 9, step: 0.5, skills: ['listening', 'reading', 'writing', 'speaking'] },
  'ielts-general': { min: 0, max: 9, step: 0.5, skills: ['listening', 'reading', 'writing', 'speaking'] },
  'pte-academic': { min: 10, max: 90, step: 1, skills: ['listening', 'reading', 'writing', 'speaking'] },
  'pte-core': { min: 10, max: 90, step: 1, skills: ['listening', 'reading', 'writing', 'speaking'] },
};

export function isValidScore(exam: ExamId, value: number): boolean {
  const s = SCORE_SCALES[exam];
  if (value < s.min || value > s.max) return false;
  const steps = (value - s.min) / s.step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

/** IELTS overall: mean of four skills, rounded to nearest 0.5 (x.25 → x.5, x.75 → x+1). */
export function ieltsOverall(scores: readonly [number, number, number, number]): number {
  const mean = scores.reduce((a, b) => a + b, 0) / 4;
  return Math.floor(mean * 2 + 0.5 + 1e-9) / 2;
}

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const IsoDateTime = z.string().datetime({ offset: true });
export const StudentId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'lowercase letters, digits and dashes');

export const SkillEstimate = z.object({
  dimension: z.string().min(1),
  value: z.number(),
  range: z.tuple([z.number(), z.number()]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidenceRefs: z.array(z.string()).default([]),
  date: IsoDate,
});
export type SkillEstimate = z.infer<typeof SkillEstimate>;

export const StudentProfile = z
  .object({
    schemaVersion: z.literal(1),
    id: StudentId,
    name: z.string().min(1),
    ageOrGrade: z.string().optional(),
    firstLanguage: z.string().default('zh'),
    /** Language of inline glosses in handouts (appendix C.2). */
    glossLanguage: z.enum(['zh', 'en-en', 'none']).default('zh'),
    delivery: z
      .object({
        mode: z.enum(['online', 'offline', 'mixed']).default('online'),
        format: z.enum(['one-to-one', 'small-group']).default('one-to-one'),
        sessionsPerWeek: z.number().int().min(1).max(14).default(2),
        minutesPerSession: z.number().int().min(15).max(240).default(90),
      })
      .default({ mode: 'online', format: 'one-to-one', sessionsPerWeek: 2, minutesPerSession: 90 }),
    goal: z.object({
      exam: ExamId,
      examDates: z.array(IsoDate).default([]),
      targetOverall: z.number(),
      targetBySkill: z.record(z.string(), z.number()).default({}),
      purpose: z.string().optional(),
    }),
    levels: z.array(SkillEstimate).default([]),
    interests: z.array(z.string()).default([]),
    learningStyle: z.string().optional(),
    parent: z
      .object({
        name: z.string().optional(),
        contact: z.string().optional(),
        cadence: z.string().optional(),
        tone: z.enum(['formal', 'warm']).default('warm'),
      })
      .optional(),
    /** Finished or paused students leave the main list but keep all their files. */
    archived: z.boolean().default(false),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .superRefine((p, ctx) => {
    const { exam, targetOverall, targetBySkill } = p.goal;
    if (!isValidScore(exam, targetOverall)) {
      ctx.addIssue({ code: 'custom', path: ['goal', 'targetOverall'], message: `not a valid ${exam} score` });
    }
    for (const [skill, v] of Object.entries(targetBySkill)) {
      if (!isValidScore(exam, v)) {
        ctx.addIssue({ code: 'custom', path: ['goal', 'targetBySkill', skill], message: `not a valid ${exam} score` });
      }
    }
  });
export type StudentProfile = z.infer<typeof StudentProfile>;

export const NewStudentInput = z.object({
  name: z.string().min(1),
  exam: ExamId,
  targetOverall: z.number(),
  examDate: IsoDate.optional(),
  ageOrGrade: z.string().optional(),
  firstLanguage: z.string().optional(),
  /** Asked when the student is added, so nothing about the lessons is assumed. */
  delivery: z
    .object({
      mode: z.enum(['online', 'offline', 'mixed']),
      sessionsPerWeek: z.number().int().min(1).max(14),
      minutesPerSession: z.number().int().min(15).max(240),
    })
    .optional(),
});
export type NewStudentInput = z.infer<typeof NewStudentInput>;

export const LessonStatus = z.enum(['planned', 'prepared', 'taught', 'reviewed']);
export const LessonId = z.string().regex(/^\d{4}-\d{2}-\d{2}-L\d{2,3}$/);

export const LessonMeta = z.object({
  schemaVersion: z.literal(1),
  id: LessonId,
  studentId: StudentId,
  number: z.number().int().min(1),
  date: IsoDate,
  minutes: z.number().int().min(15).max(240),
  topic: z.string().default(''),
  status: LessonStatus.default('planned'),
  /** Student-relative paths of materials attached to this lesson (parsed text or images). */
  materials: z.array(z.string()).default([]),
  /** Free-text brief from the teacher for this lesson. */
  brief: z.string().default(''),
  /** The tutor approved plan.json; artifacts are only generated from an approved plan (SPEC §4.3). */
  planConfirmed: z.boolean().default(false),
  createdAt: IsoDateTime,
});
export type LessonMeta = z.infer<typeof LessonMeta>;

export const SubmissionMeta = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/),
  kind: z.enum(['writing-task1', 'writing-task2']),
  /** The task prompt the student answered. */
  prompt: z.string().default(''),
  source: z.enum(['text', 'image']),
  /** Original upload inside the submission folder, for image submissions. */
  original: z.string().optional(),
  /** Set once the teacher has confirmed the transcription (image) or pasted text. */
  textConfirmed: z.boolean().default(false),
  /** Teacher's final band per criterion; only these feed the trend charts. */
  finalBands: z.record(z.string(), z.number()).default({}),
  status: z.enum(['new', 'reviewed', 'finalised']).default('new'),
  createdAt: IsoDateTime,
});
export type SubmissionMeta = z.infer<typeof SubmissionMeta>;

/** One line of error-log.jsonl (appendix B.4). */
export const ErrorInstance = z.object({
  id: z.string().min(1),
  code: z.string().regex(/^[A-Z][A-Z0-9-]*$/),
  excerpt: z.string(),
  source: z.string(),
  lesson: z.string().optional(),
  date: IsoDate,
  status: z.enum(['open', 'practicing', 'resolved']).default('open'),
});
export type ErrorInstance = z.infer<typeof ErrorInstance>;

export const WorkspaceManifest = z.object({
  schemaVersion: z.literal(1),
  createdAt: IsoDateTime,
  templateVersion: z.string(),
});
export type WorkspaceManifest = z.infer<typeof WorkspaceManifest>;
