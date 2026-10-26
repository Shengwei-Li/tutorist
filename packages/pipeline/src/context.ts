import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveInside, type ErrorInstance, type LessonMeta, type StudentProfile, type WorkspaceService } from '@tutordesk/core';
import { LessonPlan, WritingReview } from '@tutordesk/core/artifacts';
import { examLabel } from './knowledge.js';

export interface StudentContext {
  profile: StudentProfile;
  lesson?: LessonMeta;
  openErrors: ErrorInstance[];
  /** Prompt-ready text; every fact names its source file so the model can cite it. */
  text: string;
}

const MATERIAL_BUDGET = 40_000;

async function readText(file: string, max: number): Promise<string> {
  try {
    const t = await readFile(file, 'utf8');
    return t.length > max ? `${t.slice(0, max)}\n…[truncated]` : t;
  } catch {
    return '';
  }
}

function daysUntil(date: string | undefined): string {
  if (!date) return 'not set';
  const d = Math.round((Date.parse(date) - Date.now()) / 86_400_000);
  return `${date} (${d >= 0 ? `${d} days away` : 'in the past'})`;
}

/** Collect what the model needs to know about one student (SPEC §7.6): small, cited, recent first. */
export async function buildContext(ws: WorkspaceService, studentId: string, lessonId?: string): Promise<StudentContext> {
  const dir = await ws.studentDir(studentId);
  const pr = await ws.readProfile(studentId);
  if (!pr.ok) throw new Error(`profile.json is invalid: ${pr.issues.join('; ')}`);
  const p = pr.value;
  const sections: string[] = [];

  const levels = p.levels.length ? p.levels.map((l) => `${l.dimension} ${l.value}${l.range ? ` (${l.range[0]}–${l.range[1]})` : ''} on ${l.date}`).join('; ') : 'no estimates yet';
  sections.push(`## Student (profile.json)
Name: ${p.name}${p.ageOrGrade ? `, ${p.ageOrGrade}` : ''}
Exam: ${examLabel(p.goal.exam)}; target overall ${p.goal.targetOverall}${Object.keys(p.goal.targetBySkill).length ? `; per skill ${JSON.stringify(p.goal.targetBySkill)}` : ''}${p.goal.purpose ? `; purpose: ${p.goal.purpose}` : ''}
Exam date: ${daysUntil(p.goal.examDates[0])}
Lessons: ${p.delivery.sessionsPerWeek} per week, ${p.delivery.minutesPerSession} min, ${p.delivery.mode}, ${p.delivery.format}
First language: ${p.firstLanguage}; gloss language for handouts: ${p.glossLanguage}
Current level: ${levels}
Interests: ${p.interests.join(', ') || 'unknown'}${p.learningStyle ? `\nLearning style: ${p.learningStyle}` : ''}`);

  const notes = (await readText(path.join(dir, 'notes.md'), 6000)).replace(/^# .*\n+/, '').trim();
  if (notes) sections.push(`## Tutor notes (notes.md)\n${notes}`);

  const errors = (await ws.readErrors(studentId)).items;
  const openErrors = errors.filter((e) => e.status !== 'resolved').slice(-25);
  if (openErrors.length) {
    sections.push(`## Open errors (error-log.jsonl), oldest first\n${openErrors.map((e) => `- ${e.code} "${e.excerpt}" (${e.source}, ${e.date}, ${e.status})`).join('\n')}`);
  }

  const subs = (await ws.listSubmissions(studentId)).slice(0, 3);
  const reviews: string[] = [];
  for (const s of subs) {
    const rv = await readText(path.join(dir, 'submissions', s.id, 'review.json'), 20_000);
    if (!rv) continue;
    const parsed = WritingReview.safeParse(JSON.parse(rv));
    if (!parsed.success) continue;
    const bands = Object.keys(s.finalBands).length ? `final bands ${JSON.stringify(s.finalBands)}` : parsed.data.criteria.map((c) => `${c.id} ${c.low}–${c.high}`).join(', ');
    reviews.push(`- submissions/${s.id}: ${bands}. Top issues: ${parsed.data.topIssues.map((t) => t.title).join('; ')}`);
  }
  if (reviews.length) sections.push(`## Recent writing reviews\n${reviews.join('\n')}`);

  const progress = (await readText(path.join(dir, 'progress.md'), 100_000)).replace(/^# .*\n+/, '').trim();
  if (progress) sections.push(`## Progress log (progress.md, most recent part)\n${progress.slice(-3000)}`);

  const lessons = await ws.listLessons(studentId);
  const previous = lessons.filter((l) => l.id !== lessonId).slice(-2);
  const prevLines: string[] = [];
  for (const l of previous) {
    const plan = await ws.readLessonJson(studentId, l.id, 'plan.json', LessonPlan).catch(() => null);
    prevLines.push(`- L${l.number} ${l.date} ${l.topic || ''}: ${plan ? plan.summary : 'no plan saved'}${plan?.homework.length ? ` Homework: ${plan.homework.join('; ')}` : ''}`);
  }
  if (prevLines.length) sections.push(`## Previous lessons\n${prevLines.join('\n')}`);

  let lesson: LessonMeta | undefined;
  if (lessonId) {
    lesson = await ws.readLesson(studentId, lessonId);
    sections.push(`## This lesson (lessons/${lesson.id}/lesson.json)
Lesson ${lesson.number} on ${lesson.date}, ${lesson.minutes} minutes.${lesson.topic ? `\nTopic: ${lesson.topic}` : ''}${lesson.brief ? `\nTutor's brief: ${lesson.brief}` : ''}`);
    let budget = MATERIAL_BUDGET;
    for (const m of lesson.materials) {
      if (budget <= 0 || !/\.(md|txt)$/i.test(m)) continue;
      const abs = await resolveInside(dir, m);
      const t = await readText(abs, Math.min(budget, 15_000));
      budget -= t.length;
      if (t) sections.push(`## Material: ${m}\n${t}`);
    }
  }

  return { profile: p, lesson, openErrors, text: sections.join('\n\n') };
}
