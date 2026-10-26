import type { ArtifactKind } from '@tutordesk/core/artifacts';

/**
 * LLM-as-judge rubrics (appendix A.2). Each item: id, what to check, and whether it is a hard gate.
 * Anchors: 1 = missing or wrong, 3 = present but generic, 5 = specific, accurate, ready to use.
 */
export interface RubricItem {
  id: string;
  check: string;
  hardGate?: boolean;
}

export const RUBRICS: Record<'plan' | ArtifactKind, RubricItem[]> = {
  plan: [
    { id: 'P1', check: 'Objectives are observable and measurable, each with a pass criterion and a stage that checks it.' },
    { id: 'P2', check: 'Personalised: targets the student’s own errors with quoted evidence, not generic weaknesses.' },
    { id: 'P3', check: 'Sequence follows retrieval → model → guided → independent → check; one core skill only.' },
    { id: 'P4', check: 'Timing is realistic for each activity and the student produces language for at least half the lesson.' },
    { id: 'P5', check: 'Difficulty matches the student’s level plus half to one band (i+1).' },
    { id: 'P6', check: 'No invented exam rules; any exam facts match the facts given.', hardGate: true },
  ],
  handout: [
    { id: 'D1', check: 'Content is accurate.', hardGate: true },
    { id: 'D2', check: 'Example sentences are natural and grammatically correct.', hardGate: true },
    { id: 'D3', check: 'Difficulty matches the student’s band (i+1); glosses only where needed.' },
    { id: 'D4', check: 'High information density; no filler or generic study tips.' },
    { id: 'D5', check: 'Has space for the student to work on the page (practice, self-check).' },
    { id: 'D6', check: 'Uses the student’s own writing or errors (e.g. in the compare block).' },
    { id: 'D7', check: 'One emphasis style, at most three emphasised items per block; readable in black and white.' },
  ],
  worksheet: [
    { id: 'H1', check: 'Exercises align with the lesson objectives.' },
    { id: 'H2', check: 'Sequenced: recycling warm-up → new type → interleaved older type → timed task.' },
    { id: 'H3', check: 'Every answer is correct and unambiguous; open items are clearly marked as open.', hardGate: true },
    { id: 'H4', check: 'Explanations ("why") point to the locating clue or rule, so the student can self-check.' },
    { id: 'H5', check: 'Instructions are unambiguous (word limits, time, what to write).' },
    { id: 'H6', check: 'Texts and items are original, not copied from published exam books.' },
    { id: 'H7', check: 'Recycles the student’s earlier errors in a new surface form.' },
    { id: 'H8', check: 'Exam format is faithful (TFNG legend, word limits, PTE task conventions).', hardGate: true },
  ],
  script: [
    { id: 'L1', check: 'Measurable aims; each stage has a clear purpose.' },
    { id: 'L2', check: 'Times add up and are realistic; student output at least half; no tutor monologue over five minutes.', hardGate: true },
    { id: 'L3', check: 'Personalised: uses at least two of the student’s real errors or sentences in practice.' },
    { id: 'L4', check: 'Model texts and tasks pitched at target band plus half to one band.' },
    { id: 'L5', check: 'Tutor talk is verbatim and sayable, with expected answers and follow-ups.' },
    { id: 'L6', check: 'Questions diagnose understanding (never "Do you understand?").' },
    { id: 'L7', check: 'Two concrete fallback plans (struggling, finishing early).' },
    { id: 'L8', check: 'No invented exam rules.', hardGate: true },
  ],
  deck: [
    { id: 'S1', check: 'Titles state the point as a sentence; one idea per frame.' },
    { id: 'S2', check: 'No tutor script on slides; text within budget; nothing decorative.' },
    { id: 'S3', check: 'Uses the student’s real sentences in compare frames, with errors correctly marked and explained, and every revised sentence itself meets the lesson objective.', hardGate: true },
    { id: 'S4', check: 'Reveal steps are used only where the student should think first.' },
    { id: 'S5', check: 'Ends with an exit check that tests the objectives.' },
    { id: 'S6', check: 'No invented exam rules; corrections are linguistically correct.', hardGate: true },
  ],
};

export function rubricText(kind: keyof typeof RUBRICS): string {
  return RUBRICS[kind].map((r) => `${r.id}${r.hardGate ? ' (hard gate)' : ''}: ${r.check}`).join('\n');
}

/** Pass rule: every item scores at least 4. */
export function rubricPasses(scores: { score: number }[]): boolean {
  return scores.length > 0 && scores.every((s) => s.score >= 4);
}

/** A hard gate below 3 blocks the document until the tutor looks at it. */
export function hardGateFailures(scores: { criterion: string; score: number }[], kind: keyof typeof RUBRICS): string[] {
  const gates = new Set(RUBRICS[kind].filter((r) => r.hardGate).map((r) => r.id));
  return scores.filter((s) => gates.has(s.criterion) && s.score < 3).map((s) => s.criterion);
}
