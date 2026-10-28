import { Button, Dialog, Field, KeyValue, Select, TextArea, TextInput } from '@tutordesk/ui';
import { useState, type ReactNode } from 'react';
import type { ExamId, StudentProfile } from '@tutordesk/core/schemas';
import type { ProfilePatch } from '../../../shared/ipc';
import { useT, type TKey } from '../i18n';
import { fill } from '../thread/labels';

/* The student profile: labels, the editor and the summary, shared by the student page and AI proposals. */

export const EXAMS: { id: ExamId; label: string; step: number; min: number; max: number; def: number }[] = [
  { id: 'ielts-academic', label: 'IELTS Academic', step: 0.5, min: 0, max: 9, def: 6.5 },
  { id: 'ielts-general', label: 'IELTS General Training', step: 0.5, min: 0, max: 9, def: 6.5 },
  { id: 'pte-academic', label: 'PTE Academic', step: 1, min: 10, max: 90, def: 65 },
  { id: 'pte-core', label: 'PTE Core', step: 1, min: 10, max: 90, def: 65 },
];
export const SKILLS = ['listening', 'reading', 'writing', 'speaking'] as const;
export const SKILL_LABEL: Record<(typeof SKILLS)[number], { en: string; zh: string }> = {
  listening: { en: 'Listening', zh: '听力' },
  reading: { en: 'Reading', zh: '阅读' },
  writing: { en: 'Writing', zh: '写作' },
  speaking: { en: 'Speaking', zh: '口语' },
};
export const MODES = ['online', 'offline', 'mixed'] as const;
export const LANGUAGES: [string, string, string][] = [
  ['zh', '中文', 'Chinese'],
  ['yue', '粤语', 'Cantonese'],
  ['ja', '日语', 'Japanese'],
  ['ko', '韩语', 'Korean'],
  ['vi', '越南语', 'Vietnamese'],
  ['th', '泰语', 'Thai'],
  ['hi', '印地语', 'Hindi'],
  ['ar', '阿拉伯语', 'Arabic'],
  ['es', '西班牙语', 'Spanish'],
  ['pt', '葡萄牙语', 'Portuguese'],
];
export const languageName = (code: string) => {
  const l = LANGUAGES.find(([c]) => c === code);
  return l ? (zh() ? l[1] : l[2]) : code;
};

export const examLabel = (id: ExamId) => EXAMS.find((e) => e.id === id)?.label ?? id;
export const zh = () => document.documentElement.lang.startsWith('zh');
export const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full text-xs font-semibold uppercase tracking-wide text-text-3">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Everything the profile holds, grouped the way a tutor thinks about a student. */
export function ProfileDialog({
  profile,
  title,
  onSubmit,
  onSaved,
  onClose,
}: {
  profile: StudentProfile;
  title?: string;
  /** Instead of saving the profile: e.g. confirm an AI proposal with these edits. */
  onSubmit?: (patch: ProfilePatch) => Promise<void>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [p, setP] = useState(() => ({
    name: profile.name,
    ageOrGrade: profile.ageOrGrade ?? '',
    firstLanguage: profile.firstLanguage,
    exam: profile.goal.exam,
    target: String(profile.goal.targetOverall),
    examDate: profile.goal.examDates[0] ?? '',
    purpose: profile.goal.purpose ?? '',
    skills: Object.fromEntries(SKILLS.map((s) => [s, profile.goal.targetBySkill[s] !== undefined ? String(profile.goal.targetBySkill[s]) : ''])) as Record<(typeof SKILLS)[number], string>,
    perWeek: String(profile.delivery.sessionsPerWeek),
    minutes: String(profile.delivery.minutesPerSession),
    mode: profile.delivery.mode,
    format: profile.delivery.format,
    gloss: profile.glossLanguage,
    interests: profile.interests.join(', '),
    style: profile.learningStyle ?? '',
    parentName: profile.parent?.name ?? '',
    parentContact: profile.parent?.contact ?? '',
    parentCadence: profile.parent?.cadence ?? '',
    parentTone: profile.parent?.tone ?? 'warm',
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => setP((x) => ({ ...x, [k]: v }));
  const spec = EXAMS.find((e) => e.id === p.exam)!;

  const save = async () => {
    setBusy(true);
    setError(null);
    const opt = (s: string) => s.trim() || undefined;
    const patch: ProfilePatch = {
      name: p.name.trim(),
      ageOrGrade: opt(p.ageOrGrade),
      firstLanguage: p.firstLanguage.trim() || 'zh',
      glossLanguage: p.gloss,
      interests: p.interests.split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      learningStyle: opt(p.style),
      parent: p.parentName || p.parentContact || p.parentCadence ? { name: opt(p.parentName), contact: opt(p.parentContact), cadence: opt(p.parentCadence), tone: p.parentTone } : undefined,
      delivery: { sessionsPerWeek: Number(p.perWeek), minutesPerSession: Number(p.minutes), mode: p.mode, format: p.format },
      goal: {
        exam: p.exam,
        targetOverall: Number(p.target),
        examDates: p.examDate ? [p.examDate, ...profile.goal.examDates.slice(1)] : profile.goal.examDates.slice(1),
        purpose: opt(p.purpose),
        targetBySkill: Object.fromEntries(SKILLS.filter((s) => p.skills[s].trim()).map((s) => [s, Number(p.skills[s])])),
      },
    };
    try {
      if (onSubmit) await onSubmit(patch);
      else await window.tutordesk.students.update(profile.id, patch);
      onSaved();
      onClose();
    } catch (e) {
      setError(cleanError(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      wide
      title={title ?? t('student.edit')}
      onClose={onClose}
      actions={
        <>
          {error && <p className="mr-auto self-center text-sm text-danger">{error}</p>}
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button data-testid="profile-save" variant="primary" disabled={busy || !p.name.trim()} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Section title={t('profile.section.basics')}>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('students.name')}>
              <TextInput data-testid="profile-name" value={p.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label={t('profile.age')}>
              <TextInput value={p.ageOrGrade} onChange={(e) => set('ageOrGrade', e.target.value)} />
            </Field>
            <Field label={t('profile.firstLanguage')}>
              <Select value={p.firstLanguage} onChange={(e) => set('firstLanguage', e.target.value)}>
                {LANGUAGES.map(([code]) => (
                  <option key={code} value={code}>
                    {languageName(code)}
                  </option>
                ))}
                {!LANGUAGES.some(([c]) => c === p.firstLanguage) && <option value={p.firstLanguage}>{p.firstLanguage}</option>}
              </Select>
            </Field>
          </div>
        </Section>
        <Section title={t('profile.section.goal')}>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('profile.exam')}>
              <Select
                value={p.exam}
                onChange={(e) => {
                  const next = e.target.value as ExamId;
                  setP((x) => ({ ...x, exam: next, target: String(EXAMS.find((y) => y.id === next)!.def), skills: { listening: '', reading: '', writing: '', speaking: '' } }));
                }}
              >
                {EXAMS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('students.target')}>
              <TextInput type="number" step={spec.step} min={spec.min} max={spec.max} value={p.target} onChange={(e) => set('target', e.target.value)} />
            </Field>
            <Field label={t('profile.examDate')}>
              <TextInput type="date" value={p.examDate} onChange={(e) => set('examDate', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {SKILLS.map((s) => (
              <Field key={s} label={`${zh() ? SKILL_LABEL[s].zh : SKILL_LABEL[s].en}`}>
                <TextInput type="number" step={spec.step} min={spec.min} max={spec.max} placeholder="—" value={p.skills[s]} onChange={(e) => set('skills', { ...p.skills, [s]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Field label={t('profile.purpose')}>
            <TextInput value={p.purpose} onChange={(e) => set('purpose', e.target.value)} />
          </Field>
        </Section>
        <Section title={t('profile.section.lessons')}>
          <div className="grid grid-cols-4 gap-3">
            <Field label={t('students.perWeek')}>
              <TextInput type="number" min={1} max={14} value={p.perWeek} onChange={(e) => set('perWeek', e.target.value)} />
            </Field>
            <Field label={t('students.minutes')}>
              <TextInput type="number" min={15} max={240} step={5} value={p.minutes} onChange={(e) => set('minutes', e.target.value)} />
            </Field>
            <Field label={t('students.mode')}>
              <Select value={p.mode} onChange={(e) => set('mode', e.target.value as typeof p.mode)}>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`mode.${m}` as TKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('profile.format')}>
              <Select value={p.format} onChange={(e) => set('format', e.target.value as typeof p.format)}>
                <option value="one-to-one">{t('format.one-to-one')}</option>
                <option value="small-group">{t('format.small-group')}</option>
              </Select>
            </Field>
          </div>
        </Section>
        <Section title={t('profile.section.prefs')}>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('profile.gloss')}>
              <Select value={p.gloss} onChange={(e) => set('gloss', e.target.value as typeof p.gloss)}>
                <option value="zh">{t('gloss.zh')}</option>
                <option value="en-en">{t('gloss.en-en')}</option>
                <option value="none">{t('gloss.none')}</option>
              </Select>
            </Field>
            <div className="col-span-2">
              <Field label={t('profile.interests')} hint={t('profile.interestsHint')}>
                <TextInput value={p.interests} onChange={(e) => set('interests', e.target.value)} />
              </Field>
            </div>
          </div>
          <Field label={t('profile.style')}>
            <TextArea rows={2} value={p.style} onChange={(e) => set('style', e.target.value)} />
          </Field>
        </Section>
        <Section title={t('profile.parent')}>
          <div className="grid grid-cols-4 gap-3">
            <Field label={t('profile.parentName')}>
              <TextInput value={p.parentName} onChange={(e) => set('parentName', e.target.value)} />
            </Field>
            <Field label={t('profile.parentContact')}>
              <TextInput value={p.parentContact} onChange={(e) => set('parentContact', e.target.value)} />
            </Field>
            <Field label={t('profile.parentCadence')}>
              <TextInput value={p.parentCadence} onChange={(e) => set('parentCadence', e.target.value)} />
            </Field>
            <Field label={t('profile.parentTone')}>
              <Select value={p.parentTone} onChange={(e) => set('parentTone', e.target.value as typeof p.parentTone)}>
                <option value="warm">{t('tone.warm')}</option>
                <option value="formal">{t('tone.formal')}</option>
              </Select>
            </Field>
          </div>
        </Section>
      </div>
    </Dialog>
  );
}

export function ProfileSummary({ p }: { p: StudentProfile }) {
  const t = useT();
  const none = <span className="text-text-3">{t('common.notSet')}</span>;
  const skills = SKILLS.filter((s) => p.goal.targetBySkill[s] !== undefined).map((s) => `${zh() ? SKILL_LABEL[s].zh : SKILL_LABEL[s].en} ${p.goal.targetBySkill[s]}`);
  const schedule = fill(t('profile.scheduleValue'), { n: p.delivery.sessionsPerWeek, m: p.delivery.minutesPerSession, mode: t(`mode.${p.delivery.mode}` as TKey) }) + (p.delivery.format === 'small-group' ? ` · ${t('format.small-group')}` : '');
  const items: [string, ReactNode][] = [
    [t('profile.section.goal'), [`${examLabel(p.goal.exam)} ${p.goal.targetOverall}`, skills.join(' · '), p.goal.examDates[0] && `${t('profile.examDate')} ${p.goal.examDates[0]}`].filter(Boolean).join(' · ')],
    [t('profile.section.lessons'), schedule],
    [t('profile.gloss'), t(`gloss.${p.glossLanguage}` as TKey)],
    [t('profile.interests'), p.interests.length ? p.interests.join('、') : none],
    [t('profile.style'), p.learningStyle || none],
  ];
  items.splice(2, 0, [t('profile.firstLanguage'), languageName(p.firstLanguage)]);
  if (p.ageOrGrade) items.splice(2, 0, [t('profile.age'), p.ageOrGrade]);
  if (p.parent?.name || p.parent?.contact) items.push([t('profile.parent'), [p.parent.name, p.parent.contact, p.parent.cadence].filter(Boolean).join(' · ')]);
  return <KeyValue items={items} />;
}
