import type { ArtifactKind, LessonPlan, QaCheck } from '@tutordesk/core/artifacts';
import type { ExamId } from '@tutordesk/core';
import { ARTIFACT_RULES, QUALITY_BAR, TAXONOMY, TEACHING_RULES, examFacts } from './knowledge.js';
import { rubricText, type RUBRICS } from './rubrics.js';

/**
 * Prompt builders. Stable material (role, rules, exam facts) comes first so prompt caching can reuse it;
 * the student context and the task come last (SPEC §7.6).
 */

export function systemFor(exam: ExamId): string {
  return `You are an expert ${exam.startsWith('pte') ? 'PTE' : 'IELTS'} tutor and materials designer helping a private one-to-one tutor prepare lessons.

${examFacts(exam)}

${TEACHING_RULES}

${QUALITY_BAR}`;
}

export function planPrompt(context: string, opts: { brief?: string; outputs: ArtifactKind[]; minutes: number }): string {
  return `${context}

## Task
Plan this lesson as a plan card. It must:
- run exactly ${opts.minutes} minutes in total (the stage minutes must add up to ${opts.minutes});
- focus on one core skill chosen from the student's evidence (open errors, tutor notes, recent reviews, the tutor's brief);
- open with a retrieval stage and include a check stage that tests every objective;
- list the student's errors it targets, each with quoted evidence and its error code;
- produce these outputs: ${opts.outputs.join(', ')} (assign each stage the outputs it uses).
${opts.brief ? `\nThe tutor adds: ${opts.brief}\n` : ''}
${TAXONOMY}

Return the plan card as JSON.`;
}

export function artifactPrompt(kind: ArtifactKind, context: string, plan: LessonPlan, minutes: number): string {
  const stages = plan.stages.filter((s) => s.materials.includes(kind));
  return `${context}

## Approved plan card (lesson ${minutes} min)
${JSON.stringify(plan, null, 2)}

## Task
Write the ${kind} for this lesson, following the approved plan card exactly.${stages.length ? ` It is used in these stages: ${stages.map((s) => `${s.id} "${s.title}"`).join(', ')}.` : ''}

${ARTIFACT_RULES[kind]}

Text fields are plain prose with this markup only: *emphasis*, {{word|gloss}}, [[ipa:/…/]]${kind === 'worksheet' || kind === 'handout' ? ', [[gap:answer]] in gap-fill lines' : ''}${kind === 'deck' ? ', [[err:…]], [[fix:…]], [[sample:…]]' : ''}${kind === 'script' ? ', || for a pause in tutor talk' : ''}. Never write LaTeX.

Return the ${kind} as JSON.`;
}

export function reviewPrompt(kind: keyof typeof RUBRICS, context: string, docJson: string, extra = ''): string {
  return `You are reviewing a ${kind === 'plan' ? 'lesson plan card' : kind} written for a private tutor. Be strict and specific.

${context}

## Document under review
${docJson}
${extra}
## Rubric
Score every item 1–5 (1 = missing or wrong, 3 = present but generic, 5 = specific, accurate and ready to use). Quote the document as evidence before scoring. For any score below 5, give one concrete fix the writer can apply.
${rubricText(kind)}

Return JSON with one score per rubric item and a short overall comment.`;
}

export function revisePrompt(kind: string, docJson: string, problems: string[], teacherInstruction?: string): string {
  return `Revise this ${kind}. Keep everything that is already good and keep node ids stable.

## Current ${kind}
${docJson}

## Fix these problems
${problems.map((p) => `- ${p}`).join('\n') || '- (none listed)'}
${teacherInstruction ? `\n## The tutor's instruction (highest priority)\n${teacherInstruction}\n` : ''}
Return the complete revised ${kind} as JSON.`;
}

export function problemsFrom(checks: QaCheck[], scores: { criterion: string; score: number; fix: string }[]): string[] {
  return [
    ...checks.filter((c) => c.severity === 'error').map((c) => `${c.message}${c.nodeId ? ` (node ${c.nodeId})` : ''}`),
    ...scores.filter((s) => s.score < 4 && s.fix).map((s) => `${s.criterion}: ${s.fix}`),
  ];
}

export function writingReviewPrompt(opts: { exam: ExamId; context: string; task: 'task1' | 'task2'; taskPrompt: string; essay: string; wordCount: number }): string {
  const first = opts.task === 'task1' ? 'TA' : 'TR';
  return `${opts.context}

## Essay to review (${opts.task === 'task1' ? 'Writing Task 1' : 'Writing Task 2'}, ${opts.wordCount} words)
Question: ${opts.taskPrompt || '(not given)'}

${opts.essay}

## Task
Review this essay the way an experienced examiner-trained tutor would.
- Give a band range for each of ${first}, CC, LR and GRA (half-band steps; range at most one band wide). Match the paraphrased descriptors and quote the essay as evidence.
- Annotate up to 20 specific problems. Copy the exact words from the essay in "quote" (enough words to be unique). Use the error codes below.
- Pick the top three issues that cost the most marks, with a concrete action for the next essay.
- Rewrite one weak paragraph or sentence group: keep the student's idea and raise it by half to one band only.
- Suggest one focused task for the next essay.
Be honest and encouraging; never promise a score.

${TAXONOMY}

Return the review as JSON.`;
}

export const TRANSCRIBE_PROMPT = `Transcribe the handwritten or photographed student essay in the attached image exactly as written, including the student's spelling and grammar mistakes. Do not correct anything. Keep paragraph breaks as blank lines. Mark words you cannot read as [?]. Return JSON with the transcription and a list of words you were unsure about.`;
