import type { ArtifactKind } from '@tutordesk/core/artifacts';
import type { TKey } from '../i18n';
import { fill, kindLabel } from '../thread/labels';

/** "2026-10-28-L02" → "L02". */
const lessonLabel = (id: string) => /-(L\d+)$/.exec(id)?.[1] ?? id;

const RULES: [RegExp, TKey, (m: RegExpExecArray) => Record<string, string>][] = [
  [/^Create student /, 'history.createStudent', () => ({})],
  [/^Create lesson (\S+)/, 'history.createLesson', (m) => ({ l: lessonLabel(m[1]!) })],
  [/^Update lesson (\S+)/, 'history.updateLesson', (m) => ({ l: lessonLabel(m[1]!) })],
  [/^Delete lesson (\S+)/, 'history.deleteLesson', (m) => ({ l: lessonLabel(m[1]!) })],
  [/^Plan lesson (\S+)/, 'history.plan', (m) => ({ l: lessonLabel(m[1]!) })],
  [/^Approve plan for (\S+)/, 'history.approve', (m) => ({ l: lessonLabel(m[1]!) })],
  [/^Generate (\w+) for (\S+)/, 'history.generate', (m) => ({ kind: kindLabel(m[1] as ArtifactKind, true), l: lessonLabel(m[2]!) })],
  [/^Review (handout|worksheet|script|deck) for (\S+)/, 'history.reviewDoc', (m) => ({ kind: kindLabel(m[1] as ArtifactKind, true), l: lessonLabel(m[2]!) })],
  [/^Brief for (\S+)/, 'history.brief', (m) => ({ l: lessonLabel(m[1]!) })],
  [/^Attach materials to (\S+)/, 'history.attach', (m) => ({ l: lessonLabel(m[1]!) })],
  [/^Add materials? /, 'history.addMaterials', () => ({})],
  [/^Add submission /, 'history.addSubmission', () => ({})],
  [/^Delete submission /, 'history.deleteSubmission', () => ({})],
  [/^Confirm text of /, 'history.confirmText', () => ({})],
  [/^Transcribe /, 'history.transcribe', () => ({})],
  [/^Finalise review of /, 'history.finalise', () => ({})],
  [/^Review \S+/, 'history.reviewEssay', () => ({})],
  [/^Update profile/, 'history.profile', () => ({})],
  [/^Archive student/, 'history.archive', () => ({})],
  [/^Restore student/, 'history.restore', () => ({})],
  [/^(Mark|Remove) error /, 'history.errors', () => ({})],
  [/^Note/, 'history.note', () => ({})],
];

/** A git commit message as a sentence a tutor reads, plus who did it when an agent did. */
export function describeCommit(t: (k: TKey) => string, message: string): { text: string; by?: string } {
  const by = /\(([^)]+)\)\s*$/.exec(message)?.[1];
  for (const [re, key, vars] of RULES) {
    const m = re.exec(message);
    if (m) return { text: fill(t(key), vars(m)), by };
  }
  return { text: message };
}
