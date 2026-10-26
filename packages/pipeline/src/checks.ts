import type { ArtifactDoc, DeckDoc, HandoutDoc, LessonPlan, QaCheck, ScriptDoc, WorksheetDoc } from '@tutordesk/core/artifacts';
import { plainText } from '@tutordesk/render';

/**
 * Deterministic checks (SPEC §7.4, appendix A.3): cheap, exact, and run before any LLM review.
 * Errors block approval; warnings are shown to the tutor.
 */

// Direct address to a group ("Everyone, …", "Students, …") or group-work wording. Bare "everyone" or
// "class" is legitimate content ("free for everyone", "word class").
const CLASSROOM = /(?:^|[.!?:"]\s*)(?:everyone|everybody|students|class|guys),|\b(?:group work|in groups|pair work|classmates|the whole class)\b|同学们/im;
const PROMISES = /\b(guarantee[sd]?|promise[sd]?|will definitely (get|reach|score))\b|保证|包过/i;
const RULE_MYTHS: [RegExp, string][] = [
  [/task\s*[12][^.]{0,40}\b\d{1,3}(?:\.\d+)?\s?%/i, 'States a percentage weighting for a writing task; the rule is only "Task 2 counts twice as much as Task 1".'],
  [/(lose|deduct|minus)[^.]{0,40}(per|for (each|every))[^.]{0,20}(word|missing)/i, 'Claims a fixed deduction per missing word; there is none.'],
  [/(rounded|round) down/i, 'Says the overall band is rounded down; it is rounded to the nearest half band (x.25 and x.75 round up).'],
  [/part 2[^.]{0,60}(penal|deduct|lose (a|one) band)/i, 'Claims a fixed penalty for a short Part 2; there is none.'],
];
const VAGUE_OBJECTIVE = /^(understand|know|learn|be aware of|improve|get better at|了解|掌握|提高)/i;

function textOf(doc: unknown): string {
  return JSON.stringify(doc);
}

function common(doc: unknown, add: (c: QaCheck) => void) {
  const t = textOf(doc);
  if (CLASSROOM.test(t)) add({ id: 'one-to-one', severity: 'error', message: `Classroom wording in a one-to-one lesson: "${CLASSROOM.exec(t)![0]}".` });
  if (PROMISES.test(t)) add({ id: 'no-promises', severity: 'error', message: `Promises an outcome: "${PROMISES.exec(t)![0]}".` });
  for (const [re, msg] of RULE_MYTHS) if (re.test(t)) add({ id: 'exam-facts', severity: 'error', message: msg });
}

function uniqueIds(ids: string[], add: (c: QaCheck) => void) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) add({ id: 'unique-ids', severity: 'error', message: `Duplicate id "${id}".`, nodeId: id });
    seen.add(id);
  }
}

export function checkPlan(plan: LessonPlan, lessonMinutes: number, openErrorCount: number): QaCheck[] {
  const out: QaCheck[] = [];
  const add = (c: QaCheck) => out.push(c);
  const total = plan.stages.reduce((a, s) => a + s.minutes, 0);
  if (total !== lessonMinutes) add({ id: 'time-total', severity: 'error', message: `Stages add up to ${total} min; the lesson is ${lessonMinutes} min.` });
  if (plan.stages[0]?.phase !== 'retrieval') add({ id: 'retrieval-first', severity: 'warning', message: 'The lesson does not open with retrieval of earlier material.' });
  if (!plan.stages.some((s) => s.phase === 'check')) add({ id: 'has-check', severity: 'error', message: 'No check stage tests the objectives.' });
  const stageIds = new Set(plan.stages.map((s) => s.id));
  for (const o of plan.objectives) {
    if (!stageIds.has(o.checkedBy)) add({ id: 'objective-checked', severity: 'error', message: `Objective "${o.text}" names a checking stage "${o.checkedBy}" that does not exist.`, nodeId: o.id });
    if (VAGUE_OBJECTIVE.test(o.text.trim())) add({ id: 'objective-measurable', severity: 'error', message: `Objective is not observable: "${o.text}".`, nodeId: o.id });
  }
  const needed = Math.min(2, openErrorCount);
  if (plan.focusErrors.length < needed) add({ id: 'personalised', severity: 'error', message: `Targets ${plan.focusErrors.length} of the student's errors; at least ${needed} expected.` });
  const output = plan.stages.filter((s) => ['guided', 'independent', 'check', 'retrieval'].includes(s.phase)).reduce((a, s) => a + s.minutes, 0);
  if (output < lessonMinutes * 0.5) add({ id: 'student-output', severity: 'warning', message: `Student practice stages total ${output} min, under half the lesson.` });
  const longest = plan.stages.filter((s) => s.phase === 'input').reduce((m, s) => Math.max(m, s.minutes), 0);
  if (longest > 20) add({ id: 'input-length', severity: 'warning', message: `An input stage runs ${longest} min; break up tutor talk.` });
  uniqueIds(plan.stages.map((s) => s.id), add);
  common(plan, add);
  return out;
}

function checkWorksheetItems(doc: WorksheetDoc | HandoutDoc, add: (c: QaCheck) => void) {
  const exercises = doc.kind === 'worksheet' ? doc.exercises : doc.blocks.flatMap((b) => (b.type === 'exercise' ? [b.exercise] : []));
  const ids: string[] = [];
  for (const ex of exercises) {
    ids.push(ex.id);
    for (const it of ex.items) {
      ids.push(it.id);
      switch (it.type) {
        case 'mcq':
          if (it.answer >= it.options.length) add({ id: 'answer-key', severity: 'error', message: `MCQ answer index ${it.answer} is out of range.`, nodeId: it.id });
          if (new Set(it.options.map((o) => o.trim().toLowerCase())).size !== it.options.length) add({ id: 'answer-key', severity: 'error', message: 'MCQ has duplicate options.', nodeId: it.id });
          break;
        case 'tfng': {
          const allowed = it.variant === 'TFNG' ? ['TRUE', 'FALSE', 'NOT GIVEN'] : it.variant === 'YNNG' ? ['YES', 'NO', 'NOT GIVEN'] : ['TRUE', 'FALSE'];
          for (const s of it.statements) if (!allowed.includes(s.answer)) add({ id: 'answer-key', severity: 'error', message: `${it.variant} statement has answer ${s.answer}.`, nodeId: it.id });
          break;
        }
        case 'gapfill': {
          const gaps = it.lines.join(' ').match(/\[\[gap:[^\]]+\]\]/g) ?? [];
          if (!gaps.length) add({ id: 'answer-key', severity: 'error', message: 'Gap-fill has no [[gap:answer]] markers.', nodeId: it.id });
          for (const g of gaps) if (g.slice(6, -2).trim().split(/\s+/).length > 3) add({ id: 'gap-length', severity: 'warning', message: `Gap answer "${g.slice(6, -2)}" is long for note completion.`, nodeId: it.id });
          break;
        }
        case 'matching': {
          const letters = 'ABCDEFGH'.slice(0, it.options.length);
          for (const p of it.prompts) if (!letters.includes(p.answer)) add({ id: 'answer-key', severity: 'error', message: `Matching answer ${p.answer} has no option.`, nodeId: it.id });
          break;
        }
        case 'reorder': {
          const pos = it.paragraphs.map((p) => p.position).sort((a, b) => a - b);
          if (pos.some((p, i) => p !== i + 1)) add({ id: 'answer-key', severity: 'error', message: `Re-order positions ${pos.join(',')} are not 1..${pos.length}.`, nodeId: it.id });
          if (it.paragraphs.every((p, i) => p.position === i + 1)) add({ id: 'answer-key', severity: 'error', message: 'Re-order paragraphs are already in the correct order.', nodeId: it.id });
          break;
        }
        case 'passage': {
          const words = plainText(it.paragraphs.map((p) => p.text).join(' ')).split(/\s+/).length;
          if (words < 80) add({ id: 'passage-length', severity: 'warning', message: `Passage is only ${words} words.`, nodeId: it.id });
          break;
        }
      }
    }
  }
  uniqueIds(ids, add);
}

function countEmphasis(s: string): number {
  return (s.match(/\*[^*\n]+\*/g) ?? []).length;
}

export function checkHandout(doc: HandoutDoc): QaCheck[] {
  const out: QaCheck[] = [];
  const add = (c: QaCheck) => out.push(c);
  if (doc.blocks[0]?.type !== 'objectives') add({ id: 'objectives-first', severity: 'warning', message: 'The handout does not start with objectives.' });
  if (!doc.blocks.some((b) => b.type === 'compare')) add({ id: 'contrast', severity: 'warning', message: 'No compare block (effective vs less effective).' });
  if (!doc.blocks.some((b) => b.type === 'exercise')) add({ id: 'practice-space', severity: 'warning', message: 'No practice on the handout itself.' });
  for (const b of doc.blocks) {
    const n = countEmphasis(JSON.stringify(b));
    if (n > 3) add({ id: 'emphasis', severity: 'warning', message: `${n} emphasised items in one block; keep it to three.`, nodeId: b.id });
  }
  uniqueIds(doc.blocks.map((b) => b.id), add);
  checkWorksheetItems(doc, add);
  common(doc, add);
  return out;
}

export function checkWorksheet(doc: WorksheetDoc): QaCheck[] {
  const out: QaCheck[] = [];
  const add = (c: QaCheck) => out.push(c);
  checkWorksheetItems(doc, add);
  common(doc, add);
  return out;
}

export function checkScript(doc: ScriptDoc, lessonMinutes: number): QaCheck[] {
  const out: QaCheck[] = [];
  const add = (c: QaCheck) => out.push(c);
  const total = doc.stages.reduce((a, s) => a + s.minutes, 0);
  if (total !== lessonMinutes) add({ id: 'time-total', severity: 'error', message: `Stages add up to ${total} min; the lesson is ${lessonMinutes} min.` });
  const fallbacks = doc.stages.flatMap((s) => s.steps).filter((s) => s.type === 'fallback').length;
  if (fallbacks < 2) add({ id: 'fallbacks', severity: 'error', message: `${fallbacks} fallback plan(s); include one for a struggling student and one for finishing early.` });
  for (const st of doc.stages) {
    if (!st.steps.some((s) => s.type === 'say' || s.type === 'action')) add({ id: 'actionable', severity: 'warning', message: `Stage "${st.title}" has no talk or directions.`, nodeId: st.id });
    for (const s of st.steps) {
      if (s.type === 'probe' && s.items.some((i) => /do you understand|any questions|is that clear|明白了吗/i.test(i))) {
        add({ id: 'diagnostic-questions', severity: 'warning', message: 'Probe asks "Do you understand?"; ask a question that reveals understanding.', nodeId: st.id });
      }
    }
  }
  uniqueIds(doc.stages.map((s) => s.id), add);
  common(doc, add);
  return out;
}

export function checkDeck(doc: DeckDoc): QaCheck[] {
  const out: QaCheck[] = [];
  const add = (c: QaCheck) => out.push(c);
  for (const f of doc.frames) {
    if (f.type !== 'frame') continue;
    if (f.title.length > 48) add({ id: 'budget', severity: 'warning', message: `Title is ${f.title.length} characters: "${f.title}".`, nodeId: f.id });
    for (const b of f.blocks) {
      if (b.type === 'compare') {
        const errs = (b.original.match(/\[\[err:/g) ?? []).length;
        if (errs !== b.notes.length) add({ id: 'compare-notes', severity: 'error', message: `${errs} [[err:]] marks but ${b.notes.length} notes.`, nodeId: f.id });
        if (plainText(b.original).length > 170 || plainText(b.revised).length > 170) add({ id: 'budget', severity: 'warning', message: 'Compare sentences exceed 160 characters.', nodeId: f.id });
      }
      if (b.type === 'timed') {
        const [mm = 0, ss = 0] = b.time.split(':').map(Number);
        if (ss >= 60 || mm * 60 + ss === 0) add({ id: 'timer', severity: 'error', message: `Invalid timer "${b.time}".`, nodeId: f.id });
      }
    }
    if (f.blocks.length > 1 && f.blocks.some((b) => ['wrapup', 'timed', 'cuecard'].includes(b.type))) {
      add({ id: 'budget', severity: 'warning', message: 'Two blocks on a frame with a large block; likely to overflow.', nodeId: f.id });
    }
  }
  const last = [...doc.frames].reverse().find((f) => f.type === 'frame');
  if (!(last?.type === 'frame' && last.blocks.some((b) => b.type === 'wrapup'))) add({ id: 'exit-check', severity: 'warning', message: 'The deck does not end with a wrap-up and exit check.' });
  uniqueIds(doc.frames.map((f) => f.id), add);
  common(doc, add);
  return out;
}

export function checkArtifact(doc: ArtifactDoc, lessonMinutes: number): QaCheck[] {
  switch (doc.kind) {
    case 'handout':
      return checkHandout(doc);
    case 'worksheet':
      return checkWorksheet(doc);
    case 'script':
      return checkScript(doc, lessonMinutes);
    case 'deck':
      return checkDeck(doc);
  }
}
