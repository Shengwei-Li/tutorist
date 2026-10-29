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

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
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
  /** Original upload inside the submission folder, for image submissions: a file name, never a path. */
  original: z.string().regex(/^original\.[a-z0-9]{1,5}$/).optional(),
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

/* ───────────────── proposals ───────────────── */

/**
 * Proposals: what an agent wants to change about students and their schedule. Agents never write a
 * profile or a batch of lessons directly; they leave a proposal, the tutor confirms (or edits, or
 * dismisses) it in TutorDesk, and only then does TutorDesk apply it. Same gate as the plan card.
 */
const Delivery = z.object({
  mode: z.enum(['online', 'offline', 'mixed']),
  format: z.enum(['one-to-one', 'small-group']),
  sessionsPerWeek: z.number().int().min(1).max(14),
  minutesPerSession: z.number().int().min(15).max(240),
});

const Parent = z.object({ name: z.string().optional(), contact: z.string().optional(), cadence: z.string().optional(), tone: z.enum(['formal', 'warm']) });

/** What may change on an existing profile. The merged profile is validated again as a whole. */
export const ProfileChanges = z
  .object({
    name: z.string().trim().min(1),
    ageOrGrade: z.string().optional(),
    firstLanguage: z.string().describe('ISO code, e.g. "zh", "yue", "ja"'),
    glossLanguage: z.enum(['zh', 'en-en', 'none']),
    delivery: Delivery.partial(),
    goal: z
      .object({
        exam: ExamId,
        examDates: z.array(IsoDate).describe('Earliest first'),
        targetOverall: z.number(),
        targetBySkill: z.record(z.string(), z.number()).describe('Replaces the whole map, e.g. {"writing": 7, "speaking": 6.5}'),
        purpose: z.string().optional(),
      })
      .partial(),
    levels: z.array(SkillEstimate).describe('Current levels, replaces the whole list'),
    interests: z.array(z.string()),
    learningStyle: z.string().optional(),
    parent: Parent.partial({ tone: true }).optional(),
  })
  .partial();
export type ProfileChanges = z.infer<typeof ProfileChanges>;

export function mergeProfile(cur: StudentProfile, c: ProfileChanges): StudentProfile {
  return {
    ...cur,
    ...c,
    delivery: { ...cur.delivery, ...c.delivery },
    goal: { ...cur.goal, ...c.goal },
    parent: c.parent ? { tone: 'warm', ...c.parent } : 'parent' in c ? undefined : cur.parent,
  };
}

export const ProposedLesson = z.object({
  date: IsoDate,
  minutes: z.number().int().min(15).max(240).optional().describe("Default: the student's usual length"),
  topic: z.string().max(80).optional(),
  brief: z.string().max(2000).optional().describe("The tutor's own words about this lesson"),
});
export type ProposedLesson = z.infer<typeof ProposedLesson>;

/** A new student as the tutor described them. Only name, exam and target are required. */
export const ProposedStudent = z.object({
  name: z.string().trim().min(1),
  exam: ExamId,
  targetOverall: z.number(),
  examDate: IsoDate.optional(),
  delivery: Delivery.partial().optional(),
  ageOrGrade: z.string().optional(),
  firstLanguage: z.string().optional(),
  glossLanguage: z.enum(['zh', 'en-en', 'none']).optional(),
  targetBySkill: z.record(z.string(), z.number()).optional(),
  purpose: z.string().optional(),
  levels: z.array(SkillEstimate).optional(),
  interests: z.array(z.string()).optional(),
  learningStyle: z.string().optional(),
  parent: Parent.partial({ tone: true }).optional(),
});
export type ProposedStudent = z.infer<typeof ProposedStudent>;

const ProposalBase = {
  schemaVersion: z.literal(1),
  id: z.string(),
  status: z.enum(['pending', 'applied', 'dismissed']),
  createdAt: z.string(),
  /** Which agent proposed it, e.g. "claude-code". */
  by: z.string().optional(),
  /** Why, in the agent's words: shown on the card. */
  note: z.string().max(1000).optional(),
};

export const Proposal = z.discriminatedUnion('kind', [
  z.object({ ...ProposalBase, kind: z.literal('student'), student: ProposedStudent, lessons: z.array(ProposedLesson).max(30).default([]), appliedStudentId: z.string().optional() }),
  z.object({ ...ProposalBase, kind: z.literal('profile'), studentId: z.string(), changes: ProfileChanges }),
  z.object({ ...ProposalBase, kind: z.literal('lessons'), studentId: z.string(), lessons: z.array(ProposedLesson).min(1).max(30) }),
]);
export type Proposal = z.infer<typeof Proposal>;

type Fresh<K extends Proposal['kind']> = Omit<Extract<Proposal, { kind: K }>, 'schemaVersion' | 'id' | 'status' | 'createdAt'>;
export type NewProposal = Fresh<'student'> | Fresh<'profile'> | Fresh<'lessons'>;

/** The full profile a proposed student would get, without writing anything; throws a ZodError if invalid. */
export function draftProfile(s: ProposedStudent, id = 'new-student'): StudentProfile {
  const ts = new Date().toISOString();
  return StudentProfile.parse({
    schemaVersion: 1,
    id,
    name: s.name,
    ageOrGrade: s.ageOrGrade,
    firstLanguage: s.firstLanguage ?? 'zh',
    glossLanguage: s.glossLanguage,
    delivery: s.delivery ? { mode: 'online', format: 'one-to-one', sessionsPerWeek: 2, minutesPerSession: 90, ...s.delivery } : undefined,
    goal: { exam: s.exam, examDates: s.examDate ? [s.examDate] : [], targetOverall: s.targetOverall, targetBySkill: s.targetBySkill ?? {}, purpose: s.purpose },
    levels: s.levels ?? [],
    interests: s.interests ?? [],
    learningStyle: s.learningStyle,
    parent: s.parent ? { tone: 'warm', ...s.parent } : undefined,
    createdAt: ts,
    updatedAt: ts,
  });
}

/** The tutor's edits to a proposal before confirming it. */
export interface ProposalEdit {
  student?: ProposedStudent;
  changes?: ProfileChanges;
  /** The lessons to create: the proposal's own, minus any the tutor unticked, or edited ones. */
  lessons?: ProposedLesson[];
}
