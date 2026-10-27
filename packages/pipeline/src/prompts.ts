import type { ArtifactKind, LessonPlan, QaCheck } from '@tutordesk/core/artifacts';
import type { ExamId } from '@tutordesk/core';
import { ARTIFACT_RULES, QUALITY_BAR, TAXONOMY, TEACHING_RULES, examFacts, markupRules, planRules, writingReviewRules } from './knowledge.js';
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
Plan this lesson as a plan card producing these outputs: ${opts.outputs.join(', ')}.

${planRules(opts.minutes)}
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

${markupRules(kind)}

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
  return `${opts.context}

## Essay to review (${opts.task === 'task1' ? 'Writing Task 1' : 'Writing Task 2'}, ${opts.wordCount} words)
Question: ${opts.taskPrompt || '(not given)'}

${opts.essay}

## Task
${writingReviewRules(opts.task)}

${TAXONOMY}

Return the review as JSON.`;
}

export const TRANSCRIBE_PROMPT = `Transcribe the handwritten or photographed student essay in the attached image exactly as written, including the student's spelling and grammar mistakes. Do not correct anything. Keep paragraph breaks as blank lines. Mark words you cannot read as [?]. Return JSON with the transcription and a list of words you were unsure about.`;
