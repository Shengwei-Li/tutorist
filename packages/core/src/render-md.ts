import { SCORE_SCALES, type StudentProfile } from './schemas.js';

const EXAM_LABEL: Record<StudentProfile['goal']['exam'], string> = {
  'ielts-academic': 'IELTS Academic',
  'ielts-general': 'IELTS General Training',
  'pte-academic': 'PTE Academic',
  'pte-core': 'PTE Core',
};

export function examLabel(exam: StudentProfile['goal']['exam']): string {
  return EXAM_LABEL[exam];
}

function latestLevels(p: StudentProfile): string {
  const latest = new Map<string, StudentProfile['levels'][number]>();
  for (const l of p.levels) {
    const prev = latest.get(l.dimension);
    if (!prev || prev.date <= l.date) latest.set(l.dimension, l);
  }
  if (!latest.size) return '_No level estimates yet._';
  return [...latest.values()]
    .map((l) => {
      const range = l.range ? ` (range ${l.range[0]}–${l.range[1]})` : '';
      return `- ${l.dimension}: ${l.value}${range}, as of ${l.date}`;
    })
    .join('\n');
}

/** Human-readable profile; regenerated from profile.json, teachers edit notes.md instead. */
export function renderProfileMd(p: StudentProfile): string {
  const skills = SCORE_SCALES[p.goal.exam].skills;
  const targets = skills
    .filter((s) => p.goal.targetBySkill[s] !== undefined)
    .map((s) => `${s} ${p.goal.targetBySkill[s]}`)
    .join(', ');
  return `# ${p.name}

- Exam: ${examLabel(p.goal.exam)}
- Target: overall ${p.goal.targetOverall}${targets ? ` (${targets})` : ''}
- Exam date(s): ${p.goal.examDates.join(', ') || 'not set'}
- Lessons: ${p.delivery.sessionsPerWeek}× per week, ${p.delivery.minutesPerSession} min, ${p.delivery.mode}, ${p.delivery.format}
- First language: ${p.firstLanguage}; gloss language: ${p.glossLanguage}
${p.ageOrGrade ? `- Age / grade: ${p.ageOrGrade}\n` : ''}${p.interests.length ? `- Interests: ${p.interests.join(', ')}\n` : ''}
## Current level

${latestLevels(p)}

<!-- Generated from profile.json by TutorDesk. Edit notes.md for free-form notes. -->
`;
}

/**
 * Agent context file written as both CLAUDE.md and AGENTS.md so Claude Code, Codex and OpenCode
 * read the same instructions when run inside the student folder (SPEC §7.2).
 */
export function renderAgentContext(p: StudentProfile): string {
  return `# Student workspace: ${p.name}

You are preparing English exam lessons for one student of a private tutor.
Exam: ${examLabel(p.goal.exam)}. Target overall: ${p.goal.targetOverall}. Exam date(s): ${p.goal.examDates.join(', ') || 'not set'}.

## Files in this folder
- profile.json: structured profile (source of truth; do not rewrite without being asked)
- profile.md: readable summary of profile.json
- notes.md: the tutor's free-form notes; read them, never edit them
- error-log.jsonl: one error instance per line (code, excerpt, source, date, status)
- progress.md: running lesson summaries
- materials/raw/: original uploads, read-only
- materials/parsed/: parsed text of uploads
- lessons/<date>-L<nn>/: one folder per lesson; write lesson outputs only here
- submissions/: essays and recordings with their reviews

## Rules
- Every claim about the student must cite evidence (a file path and line, or a timestamp).
- Facts about exam rules must come from the exam skill files, not from memory.
- Write only where the current task says you may. Never touch materials/raw/.
- Refer to the student by name or with they/them.
`;
}
