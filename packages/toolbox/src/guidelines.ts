import type { ExamId } from '@tutordesk/core';
import type { ArtifactKind } from '@tutordesk/core/artifacts';
import { ARTIFACT_RULES, QUALITY_BAR, TAXONOMY, TEACHING_RULES, IELTS_FACTS, PTE_FACTS, markupRules, planRules, rubricText, writingReviewRules } from '@tutordesk/pipeline';

/**
 * Knowledge the agent loads on demand (appendix E.7). Every text comes from packages/pipeline, so the
 * API pipeline, the generated skills and this tool can never disagree.
 */
export const GUIDELINE_TOPICS = ['ielts', 'pte', 'error-codes', 'teaching', 'quality', 'plan', 'handout', 'worksheet', 'script', 'deck', 'writing-review', 'materials'] as const;
export type GuidelineTopic = (typeof GUIDELINE_TOPICS)[number];

export const MATERIAL_RULES = `Material rules:
- Only process files the tutor uploaded; they are for private teaching of this one student.
- Store extracted text faithfully (keep numbering, headings, answer keys) and say where it came from (file and page).
- Never copy published exam passages or questions into handouts, worksheets or decks. Refer to them by test, section and question number; quote only the line needed to explain an answer.
- New practice items must be original and labelled "Practice item written for this student, not an official exam question".`;

export function guideline(topic: GuidelineTopic): string {
  switch (topic) {
    case 'ielts':
      return IELTS_FACTS;
    case 'pte':
      return PTE_FACTS;
    case 'error-codes':
      return TAXONOMY;
    case 'teaching':
      return TEACHING_RULES;
    case 'quality':
      return QUALITY_BAR;
    case 'plan':
      return `${planRules('the lesson length')}\n\n${QUALITY_BAR}\n\nRubric the reviewer uses:\n${rubricText('plan')}`;
    case 'handout':
    case 'worksheet':
    case 'script':
    case 'deck':
      return artifactGuide(topic);
    case 'writing-review':
      return `${writingReviewRules('task2')}\n(For Task 1 use TA instead of TR.)\n\n${TAXONOMY}`;
    case 'materials':
      return MATERIAL_RULES;
  }
}

export function artifactGuide(kind: ArtifactKind): string {
  return `${ARTIFACT_RULES[kind]}\n\n${markupRules(kind)}\n\nRubric the reviewer uses (every item must score 4 or more):\n${rubricText(kind)}`;
}

export function examTopic(exam: ExamId): GuidelineTopic {
  return exam.startsWith('pte') ? 'pte' : 'ielts';
}
