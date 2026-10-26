/**
 * Lesson artifacts as JSON (SPEC §7.5, appendix D.2). The model fills these schemas; a deterministic
 * renderer turns them into LaTeX that only uses the semantic macros. Optional fields are nullable
 * (not omitted) so strict structured-output modes accept the schemas. Descriptions guide the model.
 */
import { z } from 'zod';

const Id = z.string().min(1).max(40).describe('Short id, unique within this document, e.g. "ex2-q3"');
const Text = z
  .string()
  .describe('Plain prose. Markup allowed: *emphasis*, {{word|gloss}} for an interlinear gloss, [[ipa:/.../]] for IPA. No LaTeX.');
const opt = <T extends z.ZodType>(s: T) => s.nullable();

export const ArtifactKind = z.enum(['handout', 'worksheet', 'script', 'deck']);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

/* ───────────────────────── Plan card ───────────────────────── */

export const PlanStage = z.object({
  id: Id,
  minutes: z.number().int().min(1).max(90),
  title: z.string().max(60),
  phase: z
    .enum(['retrieval', 'input', 'guided', 'independent', 'check', 'feedback', 'homework', 'break'])
    .describe('retrieval = recall last lesson; input = model + explanation; guided/independent practice; check = exit check'),
  activity: z.string().describe('What happens, concretely, in one or two sentences'),
  aim: z.string().describe('What the student can do after this stage'),
  materials: z.array(ArtifactKind).describe('Which outputs this stage uses'),
});
export type PlanStage = z.infer<typeof PlanStage>;

export const LessonPlan = z.object({
  title: z.string().max(50).describe('Short lesson title for headers, e.g. "Task 2: a clear position"'),
  summary: z.string().describe('One sentence: why this lesson, tied to the student evidence'),
  objectives: z
    .array(
      z.object({
        id: Id,
        text: z.string().describe('Observable behaviour, e.g. "write a four-part outline in 5 minutes"'),
        criterion: z.string().describe('Pass mark, e.g. "all four parts present"'),
        checkedBy: z.string().describe('Id of the stage that tests this objective'),
      }),
    )
    .min(1)
    .max(3),
  focusErrors: z
    .array(z.object({ code: z.string(), evidence: z.string().describe('Quoted student language or file reference') }))
    .min(1)
    .describe('Student errors this lesson works on, with evidence'),
  stages: z.array(PlanStage).min(3).max(12),
  homework: z.array(z.string()).max(5),
  outputs: z.array(ArtifactKind).min(1).describe('Documents to produce for this lesson'),
});
export type LessonPlan = z.infer<typeof LessonPlan>;

/* ───────────────────────── Shared meta ───────────────────────── */

export const DocMeta = z.object({
  title: z.string().max(80),
  subtitle: opt(z.string().max(120)),
  level: opt(z.string().max(40)).describe('e.g. "Band 6.0 to 7.0" or "PTE 58 to 65"'),
  timing: opt(z.string().max(20)),
  focus: opt(z.string().max(80)),
});
export type DocMeta = z.infer<typeof DocMeta>;

/* ───────────────────────── Worksheet items ───────────────────────── */

const Mcq = z.object({
  type: z.literal('mcq'),
  id: Id,
  stem: Text,
  options: z.array(z.string()).min(2).max(6),
  answer: z.number().int().min(0).describe('Index of the correct option (0-based)'),
  why: opt(z.string()),
});
const Tfng = z.object({
  type: z.literal('tfng'),
  id: Id,
  variant: z.enum(['TFNG', 'YNNG', 'TF']),
  statements: z
    .array(z.object({ text: Text, answer: z.enum(['TRUE', 'FALSE', 'NOT GIVEN', 'YES', 'NO']), why: opt(z.string()) }))
    .min(2)
    .max(8),
});
const GapFill = z.object({
  type: z.literal('gapfill'),
  id: Id,
  title: opt(z.string()),
  lines: z.array(z.string()).min(1).describe('Note lines; mark each numbered gap as [[gap:answer]]'),
});
const Matching = z.object({
  type: z.literal('matching'),
  id: Id,
  title: z.string(),
  options: z.array(z.string()).min(2).max(8).describe('Lettered A, B, C… in this order'),
  prompts: z.array(z.object({ text: Text, answer: z.string().regex(/^[A-H]$/) })).min(2),
});
const Reorder = z.object({
  type: z.literal('reorder'),
  id: Id,
  paragraphs: z
    .array(z.object({ text: Text, position: z.number().int().min(1) }))
    .min(3)
    .max(6)
    .describe('Shown in the order written (scrambled); position is the correct place, 1-based'),
});
const Dictation = z.object({
  type: z.literal('dictation'),
  id: Id,
  sentences: z.array(z.string()).min(1).max(10).describe('Write From Dictation model sentences (read aloud by the tutor)'),
});
const ShortAnswer = z.object({
  type: z.literal('short'),
  id: Id,
  prompt: Text,
  model: z.string().describe('Model answer, shown in the key'),
});
const Passage = z.object({
  type: z.literal('passage'),
  id: Id,
  title: opt(z.string()),
  note: opt(z.string()).describe('e.g. "Practice text written for this worksheet."'),
  paragraphs: z.array(z.object({ label: opt(z.string().max(2)), text: Text })).min(1),
});
const Writing = z.object({
  type: z.literal('writing'),
  id: Id,
  prompt: Text,
  lines: z.number().int().min(3).max(40),
  model: opt(z.string()).describe('Model answer or outline for the key'),
});
const WordBank = z.object({ type: z.literal('wordbank'), id: Id, title: opt(z.string()), words: z.array(z.string()).min(2) });
const CueCard = z.object({
  type: z.literal('cuecard'),
  id: Id,
  title: opt(z.string()),
  task: z.string().max(120),
  cues: z.array(z.string()).min(2).max(4),
  explain: z.string(),
  note: opt(z.string()),
});

export const ExerciseItem = z.discriminatedUnion('type', [Mcq, Tfng, GapFill, Matching, Reorder, Dictation, ShortAnswer, Passage, Writing, WordBank, CueCard]);
export type ExerciseItem = z.infer<typeof ExerciseItem>;

/** Items that may share a two-column layout (appendix C.3); everything else is full width. */
export const SHORT_ITEM_TYPES: ReadonlySet<ExerciseItem['type']> = new Set(['mcq', 'tfng', 'gapfill', 'matching', 'dictation', 'short']);

export const Exercise = z.object({
  id: Id,
  title: z.string().max(60),
  tag: opt(z.string().max(40)).describe('e.g. "IELTS Reading" or "PTE Writing"'),
  instructions: opt(z.string()),
  twoColumn: z.boolean().describe('Lay short items out in two columns (ignored for passages and writing)'),
  items: z.array(ExerciseItem).min(1),
});
export type Exercise = z.infer<typeof Exercise>;

export const WorksheetDoc = z.object({
  kind: z.literal('worksheet'),
  meta: DocMeta,
  exercises: z.array(Exercise).min(1).max(8),
});
export type WorksheetDoc = z.infer<typeof WorksheetDoc>;

/* ───────────────────────── Handout ───────────────────────── */

export const HandoutBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('objectives'), id: Id, lead: opt(z.string()), items: z.array(Text).min(1).max(4) }),
  z.object({ type: z.literal('section'), id: Id, title: z.string().max(60) }),
  z.object({ type: z.literal('paragraph'), id: Id, text: Text }),
  z.object({ type: z.literal('keypoint'), id: Id, title: opt(z.string().max(60)), text: Text }),
  z.object({
    type: z.literal('compare'),
    id: Id,
    good: z.object({
      label: opt(z.string()),
      segments: z.array(z.object({ tag: opt(z.string().max(3)).describe('e.g. P, Ex, Eg, L'), text: Text })).min(1),
    }),
    weak: z.object({ label: opt(z.string()), text: Text }),
    question: opt(z.string()).describe('Prompt under the pair, e.g. "What is the one difference?"'),
  }),
  z.object({
    type: z.literal('vocab'),
    id: Id,
    entries: z.array(z.object({ phrase: z.string(), ipa: opt(z.string()), pattern: z.string(), example: z.string() })).min(1).max(10),
  }),
  z.object({ type: z.literal('exercise'), id: Id, exercise: Exercise }),
  z.object({ type: z.literal('selfcheck'), id: Id, title: opt(z.string()), items: z.array(z.string()).min(1).max(6) }),
  z.object({ type: z.literal('teachernote'), id: Id, title: opt(z.string()), text: Text }),
]);
export type HandoutBlock = z.infer<typeof HandoutBlock>;

export const HandoutDoc = z.object({
  kind: z.literal('handout'),
  meta: DocMeta,
  blocks: z.array(HandoutBlock).min(2).max(30),
});
export type HandoutDoc = z.infer<typeof HandoutDoc>;

/* ───────────────────────── Lesson script ───────────────────────── */

export const ScriptStep = z.discriminatedUnion('type', [
  z.object({ type: z.literal('say'), text: z.string().describe('Verbatim tutor talk; use || for a pause') }),
  z.object({ type: z.literal('expect'), items: z.array(z.string()).min(1).describe('Likely student answers') }),
  z.object({ type: z.literal('probe'), items: z.array(z.string()).min(1).describe('Follow-up questions') }),
  z.object({ type: z.literal('action'), items: z.array(z.string()).min(1).describe('Stage directions') }),
  z.object({ type: z.literal('board'), text: z.string() }),
  z.object({ type: z.literal('fallback'), condition: z.string().describe('e.g. "If they finish early"'), text: z.string() }),
]);
export type ScriptStep = z.infer<typeof ScriptStep>;

export const ScriptDoc = z.object({
  kind: z.literal('script'),
  meta: DocMeta,
  materials: z.array(z.string()).max(8),
  stages: z
    .array(z.object({ id: Id, minutes: z.number().int().min(1).max(90), title: z.string().max(60), aim: opt(z.string()), steps: z.array(ScriptStep).min(1) }))
    .min(3)
    .max(12),
});
export type ScriptDoc = z.infer<typeof ScriptDoc>;

/* ───────────────────────── Deck ───────────────────────── */

export const DeckBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('objectives'), items: z.array(z.string().max(70)).min(2).max(4), bandFocus: opt(z.string()) }),
  z.object({
    type: z.literal('compare'),
    original: z.string().max(200).describe('Student sentence; mark each error as [[err:wrong words]]'),
    revised: z.string().max(200).describe('Revision; mark each fix as [[fix:new words]]'),
    notes: z.array(z.string().max(60)).max(4).describe('One note per [[err:]], same order'),
  }),
  z.object({ type: z.literal('peel'), point: z.string(), explain: z.string(), example: z.string(), link: z.string() }),
  z.object({
    type: z.literal('flow'),
    returnLabel: opt(z.string()),
    steps: z.array(z.object({ key: z.string().max(2), name: z.string().max(14), text: z.string().max(60) })).min(3).max(5),
  }),
  z.object({ type: z.literal('cuecard'), title: opt(z.string()), task: z.string().max(90), cues: z.array(z.string()).min(3).max(4), explain: z.string(), timing: opt(z.string()) }),
  z.object({ type: z.literal('taskcard'), title: opt(z.string()), text: z.string().max(300) }),
  z.object({
    type: z.literal('timed'),
    caption: opt(z.string()),
    time: z.string().regex(/^\d{1,2}:\d{2}$/),
    prompt: z.string().max(220),
    phases: z.array(z.object({ time: z.string(), text: z.string() })).max(3),
  }),
  z.object({ type: z.literal('reveal'), steps: z.array(z.object({ label: z.string().max(14), text: z.string().max(180), note: opt(z.string().max(50)) })).min(2).max(4) }),
  z.object({ type: z.literal('bullets'), items: z.array(z.string().max(90)).min(1).max(5) }),
  z.object({
    type: z.literal('wrapup'),
    summary: z.array(z.string()).max(3),
    words: z.array(z.object({ word: z.string(), ipa: z.string(), gloss: z.string() })).max(2),
    exit: z.array(z.string()).min(1).max(3).describe('Exit-check questions; mark learner language as [[sample:...]]'),
  }),
]);
export type DeckBlock = z.infer<typeof DeckBlock>;

export const DeckFrame = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('frame'),
    id: Id,
    stage: opt(z.string().max(14)).describe('Lesson phase label, e.g. Diagnose, Model, Practise, Check'),
    title: z.string().max(60).describe('A full-sentence claim where possible (assertion-evidence)'),
    blocks: z.array(DeckBlock).min(1).max(2),
    aside: opt(z.string().max(110)),
  }),
  z.object({ type: z.literal('keyframe'), id: Id, label: opt(z.string()), text: z.string().max(140) }),
]);
export type DeckFrame = z.infer<typeof DeckFrame>;

export const DeckDoc = z.object({
  kind: z.literal('deck'),
  meta: z.object({
    title: z.string().max(60),
    subtitle: opt(z.string().max(90)),
    examTag: z.string(),
    duration: opt(z.string()),
    target: opt(z.string()),
  }),
  frames: z.array(DeckFrame).min(4).max(16),
});
export type DeckDoc = z.infer<typeof DeckDoc>;

export const ARTIFACT_SCHEMAS = { handout: HandoutDoc, worksheet: WorksheetDoc, script: ScriptDoc, deck: DeckDoc } as const;
export type ArtifactDoc = HandoutDoc | WorksheetDoc | ScriptDoc | DeckDoc;

/* ───────────────────────── Writing review ───────────────────────── */

export const WritingCriterion = z.enum(['TA', 'TR', 'CC', 'LR', 'GRA']);

export const WritingReview = z.object({
  task: z.enum(['task1', 'task2']),
  criteria: z
    .array(
      z.object({
        id: WritingCriterion,
        low: z.number().min(0).max(9),
        high: z.number().min(0).max(9),
        descriptorKeywords: z.array(z.string()).max(4).describe('Phrases from the official descriptor this band matches'),
        evidence: z.array(z.string()).min(1).max(3).describe('Short quotes from the essay'),
      }),
    )
    .length(4),
  annotations: z
    .array(
      z.object({
        quote: z.string().min(1).describe('Exact words copied from the essay (enough to be unique)'),
        kind: z.enum(['grammar', 'lexis', 'cohesion', 'task']),
        code: z.string().describe('Error code from the taxonomy, e.g. W-GRA-SVA'),
        explanation: z.string().max(160),
        suggestion: z.string().max(200),
      }),
    )
    .max(25),
  topIssues: z
    .array(z.object({ title: z.string(), why: z.string().describe('Why this costs the most marks'), action: z.string().describe('What to do in the next essay') }))
    .min(1)
    .max(3),
  rewrite: z.object({ original: z.string(), improved: z.string().describe('Same idea, half to one band higher, not a band 9 model'), note: z.string() }),
  nextTask: z.string(),
});
export type WritingReview = z.infer<typeof WritingReview>;

/* ───────────────────────── Quality report ───────────────────────── */

export const QaCheck = z.object({
  id: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  nodeId: z.string().optional(),
});
export type QaCheck = z.infer<typeof QaCheck>;

export const RubricScore = z.object({
  criterion: z.string().describe('Rubric item id, e.g. L1'),
  score: z.number().int().min(1).max(5),
  hardGate: z.boolean().describe('True if this item is a hard gate (marked ⛔ in the rubric)'),
  evidence: z.string().describe('Quote from the document that justifies the score'),
  fix: z.string().describe('Concrete instruction to raise the score; empty when score is 5'),
});
export const RubricReview = z.object({ scores: z.array(RubricScore).min(3), overall: z.string().max(300) });
export type RubricReview = z.infer<typeof RubricReview>;
