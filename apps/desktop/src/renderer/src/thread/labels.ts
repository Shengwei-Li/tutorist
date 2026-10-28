import type { ArtifactKind } from '@tutordesk/core/artifacts';
import type { AgentId } from '../../../shared/ipc';
import type { TKey } from '../i18n';

export const KIND_LABEL: Record<ArtifactKind, { en: string; zh: string }> = {
  script: { en: 'Script', zh: '底稿' },
  handout: { en: 'Handout', zh: '讲义' },
  worksheet: { en: 'Worksheet', zh: '练习卷' },
  deck: { en: 'Slides', zh: '幻灯片' },
};

export const AGENT_LABEL: Record<AgentId, string> = { 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', api: 'API' };

export const isZh = () => document.documentElement.lang.startsWith('zh');

export function kindLabel(k: ArtifactKind, lower = false): string {
  const l = isZh() ? KIND_LABEL[k].zh : KIND_LABEL[k].en;
  return lower && !isZh() ? l.toLowerCase() : l;
}

/** Fill {placeholders} in a translated string. */
export function fill(s: string, vars: Record<string, string | number | undefined>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

const STEP_KEYS = new Set([
  'list_students', 'get_student_context', 'list_lessons', 'get_lesson', 'create_lesson', 'get_guidelines', 'get_artifact_schema', 'save_plan', 'get_artifact',
  'save_artifact', 'save_review_scores', 'export_pdf', 'list_submissions', 'get_submission', 'save_transcription', 'save_writing_review', 'save_material_text', 'append_note',
  'propose_student', 'propose_profile_update', 'propose_lessons',
]);

const GENERIC: Record<string, TKey> = {
  read_file: 'step.read', Read: 'step.read',
  search_text: 'step.search', Grep: 'step.search',
  list_dir: 'step.list', Glob: 'step.list', LS: 'step.list',
  shell: 'step.command', Bash: 'step.command', PowerShell: 'step.command',
  Write: 'step.edit', Edit: 'step.edit', write_markdown: 'step.edit',
};

/** One plain sentence per tool call, e.g. "Saved the handout" (appendix E.9). */
export function stepLabel(t: (k: TKey) => string, name: string, target?: string): string {
  const kind = target && target in KIND_LABEL ? kindLabel(target as ArtifactKind, true) : undefined;
  const shortTarget = kind ?? (target ? (target.split(/[\\/]/).pop() ?? target) : isZh() ? '文档' : 'document');
  if (STEP_KEYS.has(name)) return fill(t(`step.${name}` as TKey), { target: name === 'get_artifact_schema' && target === 'plan' ? (isZh() ? '计划卡' : 'plan card') : shortTarget });
  const key = GENERIC[name];
  if (key) return fill(t(key), { target: target ? `“${shortTarget.slice(0, 60)}”` : '' }).trim();
  return fill(t('step.other'), { name });
}
