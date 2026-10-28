import clsx from 'clsx';
import { Button, Dialog, EmptyState, Field, KeyValue, Menu, Panel, Select, StatusMark, TextArea, TextInput } from '@tutordesk/ui';
import { ChevronRight, FolderOpen, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { ErrorInstance, ExamId, LessonMeta, StudentProfile, SubmissionMeta } from '@tutordesk/core/schemas';
import type { ProfilePatch, StudentDetail, StudentSummary } from '../../../shared/ipc';
import { useT, type TKey } from '../i18n';
import { describeCommit } from '../student/history';
import { fill } from '../thread/labels';

const EXAMS: { id: ExamId; label: string; step: number; min: number; max: number; def: number }[] = [
  { id: 'ielts-academic', label: 'IELTS Academic', step: 0.5, min: 0, max: 9, def: 6.5 },
  { id: 'ielts-general', label: 'IELTS General Training', step: 0.5, min: 0, max: 9, def: 6.5 },
  { id: 'pte-academic', label: 'PTE Academic', step: 1, min: 10, max: 90, def: 65 },
  { id: 'pte-core', label: 'PTE Core', step: 1, min: 10, max: 90, def: 65 },
];
const SKILLS = ['listening', 'reading', 'writing', 'speaking'] as const;
const SKILL_LABEL: Record<(typeof SKILLS)[number], { en: string; zh: string }> = {
  listening: { en: 'Listening', zh: '听力' },
  reading: { en: 'Reading', zh: '阅读' },
  writing: { en: 'Writing', zh: '写作' },
  speaking: { en: 'Speaking', zh: '口语' },
};
const MODES = ['online', 'offline', 'mixed'] as const;
const LANGUAGES: [string, string, string][] = [
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
const languageName = (code: string) => {
  const l = LANGUAGES.find(([c]) => c === code);
  return l ? (zh() ? l[1] : l[2]) : code;
};
const STATUSES: LessonMeta['status'][] = ['planned', 'prepared', 'taught', 'reviewed'];

const examLabel = (id: ExamId) => EXAMS.find((e) => e.id === id)?.label ?? id;
const zh = () => document.documentElement.lang.startsWith('zh');
const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Deleting asks once, in words that say what happens to the files. */
function ConfirmDelete({ title, body, onConfirm, onClose }: { title: string; body: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            data-testid="confirm-delete"
            className="text-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(cleanError(e));
                setBusy(false);
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-2">{body}</p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Dialog>
  );
}

function NewStudentForm({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [exam, setExam] = useState<ExamId>('ielts-academic');
  const spec = EXAMS.find((e) => e.id === exam)!;
  const [target, setTarget] = useState(String(spec.def));
  const [date, setDate] = useState('');
  const [perWeek, setPerWeek] = useState('2');
  const [minutes, setMinutes] = useState('90');
  const [mode, setMode] = useState<(typeof MODES)[number]>('online');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await window.tutordesk.students.create({
        name: name.trim(),
        exam,
        targetOverall: Number(target),
        examDate: date || undefined,
        delivery: { mode, sessionsPerWeek: Number(perWeek), minutesPerSession: Number(minutes) },
      });
      onDone(p.id);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label={t('students.name')}>
        <TextInput data-testid="student-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('students.exam')}>
        <Select
          value={exam}
          onChange={(e) => {
            const next = e.target.value as ExamId;
            setExam(next);
            setTarget(String(EXAMS.find((x) => x.id === next)!.def));
          }}
        >
          {EXAMS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('students.target')}>
          <TextInput type="number" required step={spec.step} min={spec.min} max={spec.max} value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
        <Field label={t('students.examDate')}>
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('students.perWeek')}>
          <TextInput type="number" required min={1} max={14} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} />
        </Field>
        <Field label={t('students.minutes')}>
          <TextInput type="number" required min={15} max={240} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
        <Field label={t('students.mode')}>
          <Select value={mode} onChange={(e) => setMode(e.target.value as (typeof MODES)[number])}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t(`mode.${m}` as TKey)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button data-testid="student-create" variant="primary" type="submit" disabled={busy || !name.trim()}>
          {t('students.create')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('students.cancel')}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <legend className="float-left mb-1 w-full text-xs font-semibold uppercase tracking-wide text-text-3">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Everything the profile holds, grouped the way a tutor thinks about a student. */
function ProfileDialog({ profile, onSaved, onClose }: { profile: StudentProfile; onSaved: () => void; onClose: () => void }) {
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
      await window.tutordesk.students.update(profile.id, patch);
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
      title={t('student.edit')}
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

/** New lesson, or the date, length, topic and status of an existing one. */
function LessonDialog({ studentId, lesson, defaultMinutes, onSaved, onClose }: { studentId: string; lesson?: LessonMeta; defaultMinutes: number; onSaved: () => void; onClose: () => void }) {
  const t = useT();
  const [date, setDate] = useState(lesson?.date ?? todayIso());
  const [minutes, setMinutes] = useState(String(lesson?.minutes ?? defaultMinutes));
  const [topic, setTopic] = useState(lesson?.topic ?? '');
  const [status, setStatus] = useState<LessonMeta['status']>(lesson?.status ?? 'planned');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (lesson) await window.tutordesk.lessons.update(studentId, lesson.id, { date, minutes: Number(minutes), topic: topic.trim(), status });
      else await window.tutordesk.students.createLesson(studentId, { date, minutes: Number(minutes), topic: topic.trim() || undefined });
      onSaved();
      onClose();
    } catch (err) {
      setError(cleanError(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={lesson ? t('lesson.edit') : t('lesson.new')}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button data-testid="lesson-save" variant="primary" disabled={busy || !date} onClick={() => void save()}>
            {lesson ? t('common.save') : t('students.create')}
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('lesson.date')}>
            <TextInput data-testid="lesson-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('lesson.minutes')}>
            <TextInput type="number" min={15} max={240} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>
        <Field label={t('lesson.topic')} hint={lesson ? undefined : t('lesson.topicHint')}>
          <TextInput data-testid="lesson-topic" autoFocus value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
        {lesson && (
          <Field label={t('lesson.status')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as LessonMeta['status'])}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`lesson.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function WritingPanel({ studentId, submissions, onOpen, onChanged }: { studentId: string; submissions: SubmissionMeta[]; onOpen: (subId: string) => void; onChanged: () => void }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<SubmissionMeta['kind']>('writing-task2');
  const [prompt, setPrompt] = useState('');
  const [text, setText] = useState('');
  const [deleting, setDeleting] = useState<SubmissionMeta | null>(null);
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const save = async () => {
    const s = await window.tutordesk.submissions.createText(studentId, { kind, prompt: prompt.trim(), text });
    setAdding(false);
    setPrompt('');
    setText('');
    onOpen(s.id);
  };
  const fromPhoto = async () => {
    const s = await window.tutordesk.submissions.createFromImage(studentId, kind);
    if (s) onOpen(s.id);
  };

  return (
    <Panel
      title={t('writing.title')}
      actions={
        <div className="flex items-center gap-2">
          <Select className="h-7" value={kind} onChange={(e) => setKind(e.target.value as SubmissionMeta['kind'])}>
            <option value="writing-task2">Task 2</option>
            <option value="writing-task1">Task 1</option>
          </Select>
          <Button data-testid="essay-paste" className="h-7" onClick={() => setAdding(true)}>
            <Plus size={14} strokeWidth={1.5} /> {t('writing.paste')}
          </Button>
          <Button className="h-7" onClick={fromPhoto}>
            {t('writing.photo')}
          </Button>
        </div>
      }
    >
      {adding && (
        <div className="mb-4 flex flex-col gap-2">
          <TextInput data-testid="essay-prompt" placeholder={t('writing.prompt')} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <textarea data-testid="essay-new-text" rows={8} placeholder={t('writing.text')} className="rounded-sm border border-border-strong bg-surface p-2 font-serif text-sm focus:border-accent focus:outline-none" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-2">
            <Button data-testid="essay-save" variant="primary" disabled={words < 30} onClick={save}>
              {t('common.save')}
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t('students.cancel')}
            </Button>
            <span className="ml-auto text-xs text-text-3 tabular-nums">
              {words} {t('writing.words')}
              {words < 30 && ` · ${t('writing.minWords')}`}
            </span>
          </div>
        </div>
      )}
      {submissions.length === 0 && !adding ? (
        <p className="text-sm text-text-2">{t('writing.none')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {submissions.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <button data-testid={`open-sub-${s.id}`} className="flex min-w-0 flex-1 items-center justify-between py-2 text-left text-sm hover:text-accent" onClick={() => onOpen(s.id)}>
                <span className="min-w-0 truncate">
                  <span className="font-medium">{s.kind === 'writing-task1' ? 'Task 1' : 'Task 2'}</span>
                  <span className="text-text-3"> · {s.id.slice(0, 10)}</span>
                  {s.prompt && <span className="text-text-2"> · {s.prompt}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {Object.keys(s.finalBands).length > 0 && (
                    <span className="text-xs text-text-2 tabular-nums">
                      {Object.entries(s.finalBands)
                        .map(([k, v]) => `${k} ${v}`)
                        .join(' · ')}
                    </span>
                  )}
                  <StatusMark status={s.status === 'finalised' ? 'done' : s.status === 'reviewed' ? 'progress' : 'pending'}>{s.status === 'finalised' ? t('writing.finalised') : t(`writing.status.${s.status}` as 'writing.status.new')}</StatusMark>
                </span>
              </button>
              <Menu label={t('common.more')} testId={`sub-menu-${s.id}`} items={[{ label: t('writing.delete'), danger: true, onSelect: () => setDeleting(s), testId: 'sub-delete' }]} />
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDelete
          title={t('writing.deleteTitle')}
          body={t('writing.deleteBody')}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await window.tutordesk.submissions.delete(studentId, deleting.id);
            onChanged();
          }}
        />
      )}
    </Panel>
  );
}

function ErrorsPanel({ studentId, errors, onChanged }: { studentId: string; errors: ErrorInstance[]; onChanged: () => void }) {
  const t = useT();
  const open = errors.filter((e) => e.status !== 'resolved');
  const resolved = errors.length - open.length;
  const act = async (fn: () => Promise<void>) => {
    await fn();
    onChanged();
  };
  return (
    <Panel title={t('student.errors')} actions={resolved > 0 ? <span className="text-xs text-text-3">{fill(t('errors.resolvedCount'), { n: resolved })}</span> : undefined}>
      {open.length === 0 ? (
        <p className="text-sm text-text-2">{t('student.noErrors')}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {open.slice(0, 12).map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1 py-1">
                <code className="font-mono text-xs text-text-2">{e.code}</code> <span className="font-serif">{e.excerpt}</span>
                {e.status === 'practicing' && <span className="ml-2 text-xs text-accent">{t('errors.practicing')}</span>}
              </div>
              <Menu
                label={t('common.more')}
                items={[
                  ...(e.status === 'open' ? [{ label: t('errors.markPracticing'), onSelect: () => void act(() => window.tutordesk.errors.setStatus(studentId, e.id, 'practicing')) }] : []),
                  { label: t('errors.markResolved'), onSelect: () => void act(() => window.tutordesk.errors.setStatus(studentId, e.id, 'resolved')) },
                  { label: t('errors.remove'), danger: true, separated: true, onSelect: () => void act(() => window.tutordesk.errors.delete(studentId, e.id)) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ProfileSummary({ p }: { p: StudentProfile }) {
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

function StudentView({ id, onOpenLesson, onOpenSubmission, onListChanged, onDeleted }: { id: string; onOpenLesson: (lessonId: string) => void; onOpenSubmission: (subId: string) => void; onListChanged: () => void; onDeleted: () => void }) {
  const t = useT();
  const [d, setD] = useState<StudentDetail | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'profile' } | { kind: 'lesson'; lesson?: LessonMeta } | { kind: 'deleteLesson'; lesson: LessonMeta } | { kind: 'deleteStudent' }>(null);
  const load = useCallback(() => void window.tutordesk.students.get(id).then(setD), [id]);
  useEffect(load, [load]);
  if (!d) return null;
  const p = d.profile;
  const today = todayIso();

  const setStatus = async (l: LessonMeta, status: LessonMeta['status']) => {
    await window.tutordesk.lessons.update(id, l.id, { status });
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{p.name}</h1>
          <p className="mt-1 text-sm text-text-2">
            {examLabel(p.goal.exam)} · {p.goal.targetOverall}
            {p.goal.examDates[0] ? ` · ${p.goal.examDates[0]}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" onClick={() => void window.tutordesk.students.reveal(id)}>
            <FolderOpen size={16} strokeWidth={1.5} /> {t('student.openFolder')}
          </Button>
          <Menu
            label={t('common.more')}
            testId="student-menu"
            items={[
              {
                label: p.archived ? t('student.restore') : t('student.archive'),
                onSelect: async () => {
                  await window.tutordesk.students.setArchived(id, !p.archived);
                  load();
                  onListChanged();
                },
              },
              { label: t('student.delete'), danger: true, separated: true, onSelect: () => setDialog({ kind: 'deleteStudent' }), testId: 'student-delete' },
            ]}
          />
        </div>
      </header>

      {p.archived && <p className="rounded-md border border-border bg-surface-2 px-4 py-2 text-sm text-text-2">{t('student.archivedNote')}</p>}

      <Panel
        title={t('student.profile')}
        actions={
          <Button data-testid="profile-edit" variant="ghost" className="h-7" onClick={() => setDialog({ kind: 'profile' })}>
            {t('student.edit')}
          </Button>
        }
      >
        <ProfileSummary p={p} />
      </Panel>

      <Panel
        title={t('student.lessons')}
        actions={
          <Button data-testid="lesson-new" className="h-7" onClick={() => setDialog({ kind: 'lesson' })}>
            <Plus size={14} strokeWidth={1.5} /> {t('student.newLesson')}
          </Button>
        }
      >
        {d.lessons.length === 0 ? (
          <p className="text-sm text-text-2">{t('student.noLessons')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {d.lessons.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <button data-testid={`open-lesson-${l.number}`} className={clsx('flex min-w-0 flex-1 items-center justify-between py-2 text-left text-sm hover:text-accent', l.date < today && 'text-text-2')} onClick={() => onOpenLesson(l.id)}>
                  <span className="min-w-0 truncate">
                    <span className="font-medium tabular-nums">L{String(l.number).padStart(2, '0')}</span>
                    <span className="text-text-3"> · {l.date === today ? t('today.title') : l.date} · {l.minutes} min</span>
                    {l.topic && <span> · {l.topic}</span>}
                  </span>
                  <StatusMark status={l.status === 'planned' ? 'pending' : l.status === 'prepared' ? 'progress' : 'done'}>{t(`lesson.${l.status}`)}</StatusMark>
                </button>
                <Menu
                  label={t('common.more')}
                  testId={`lesson-menu-${l.number}`}
                  items={[
                    { label: t('lesson.editItem'), onSelect: () => setDialog({ kind: 'lesson', lesson: l }), testId: 'lesson-edit' },
                    ...(l.status !== 'taught' && l.status !== 'reviewed' ? [{ label: t('lesson.markTaught'), onSelect: () => void setStatus(l, 'taught') }] : []),
                    ...(l.status === 'taught' ? [{ label: t('lesson.markReviewed'), onSelect: () => void setStatus(l, 'reviewed') }] : []),
                    { label: t('lesson.delete'), danger: true, separated: true, onSelect: () => setDialog({ kind: 'deleteLesson', lesson: l }), testId: 'lesson-delete' },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <WritingPanel studentId={id} submissions={d.submissions} onOpen={onOpenSubmission} onChanged={load} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ErrorsPanel studentId={id} errors={d.errors} onChanged={load} />
        <Panel title={t('student.history')}>
          <ul className="flex flex-col gap-1.5 text-sm">
            {d.history.map((c) => {
              const h = describeCommit(t, c.message);
              return (
                <li key={c.hash} className="flex gap-3">
                  <span className="w-20 shrink-0 text-text-3 tabular-nums">{new Date(c.date).toLocaleDateString(document.documentElement.lang, { month: 'short', day: 'numeric' })}</span>
                  <span className="min-w-0 truncate" title={c.message}>
                    {h.text}
                    {h.by && <span className="text-text-3"> · {h.by}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      {dialog?.kind === 'profile' && (
        <ProfileDialog
          profile={p}
          onClose={() => setDialog(null)}
          onSaved={() => {
            load();
            onListChanged();
          }}
        />
      )}
      {dialog?.kind === 'lesson' && <LessonDialog studentId={id} lesson={dialog.lesson} defaultMinutes={p.delivery.minutesPerSession} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog?.kind === 'deleteLesson' && (
        <ConfirmDelete
          title={fill(t('lesson.deleteTitle'), { n: dialog.lesson.number })}
          body={t('lesson.deleteBody')}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await window.tutordesk.lessons.delete(id, dialog.lesson.id);
            load();
          }}
        />
      )}
      {dialog?.kind === 'deleteStudent' && (
        <ConfirmDelete
          title={fill(t('student.deleteTitle'), { name: p.name })}
          body={t('student.deleteBody')}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await window.tutordesk.students.delete(id);
            onDeleted();
          }}
        />
      )}
    </div>
  );
}

function StudentRow({ s, selected, onClick }: { s: StudentProfile; selected: boolean; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className={clsx('flex h-10 w-full flex-col justify-center px-4 text-left', selected ? 'bg-accent-soft' : 'hover:bg-surface-2', s.archived && 'text-text-2')}>
        <span className="text-sm font-medium leading-tight">{s.name}</span>
        <span className="text-xs leading-tight text-text-3">
          {examLabel(s.goal.exam)} · {s.goal.targetOverall}
        </span>
      </button>
    </li>
  );
}

export function StudentsPage({ selected, onSelect, onOpenLesson, onOpenSubmission }: { selected: string | null; onSelect: (id: string | null) => void; onOpenLesson: (studentId: string, lessonId: string) => void; onOpenSubmission: (studentId: string, subId: string) => void }) {
  const t = useT();
  const [list, setList] = useState<StudentSummary[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const load = useCallback(() => void window.tutordesk.students.list().then(setList), []);
  useEffect(load, [load]);

  useEffect(() => {
    if (list && list.length === 0) setAdding(true);
  }, [list]);

  const { active, archived, broken } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ok = (list ?? []).flatMap((s) => (s.ok ? [s.profile] : []));
    const match = ok.filter((p) => !q || p.name.toLowerCase().includes(q) || examLabel(p.goal.exam).toLowerCase().includes(q));
    return {
      active: match.filter((p) => !p.archived),
      archived: match.filter((p) => p.archived),
      broken: (list ?? []).flatMap((s) => (s.ok ? [] : [s])),
    };
  }, [list, query]);

  const pick = (id: string) => {
    setAdding(false);
    onSelect(id);
  };

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <h1 className="text-sm font-semibold">{t('students.title')}</h1>
          <Button variant="ghost" className="h-7 px-2" onClick={() => setAdding(true)} aria-label={t('students.add')}>
            <Plus size={16} strokeWidth={1.5} />
          </Button>
        </div>
        {(list?.length ?? 0) > 5 && (
          <div className="relative border-b border-border px-3 py-2">
            <Search size={14} strokeWidth={1.5} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-text-3" />
            <TextInput data-testid="student-search" className="h-7 w-full pl-7" placeholder={t('students.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
        <ul className="flex-1 overflow-auto py-1">
          {active.map((p) => (
            <StudentRow key={p.id} s={p} selected={selected === p.id} onClick={() => pick(p.id)} />
          ))}
          {query && active.length === 0 && archived.length === 0 && <li className="px-4 py-2 text-sm text-text-3">{t('students.noMatch')}</li>}
          {broken.map((s) => (
            <li key={s.id} className="px-4 py-2 text-sm">
              <span className="font-medium">{s.id}</span>
              <span className="block text-xs text-danger" title={s.issues.join('\n')}>
                {t('students.invalid')}
              </span>
            </li>
          ))}
          {archived.length > 0 && (
            <>
              <li>
                <button className="flex h-9 w-full items-center gap-1 px-4 text-left text-xs font-medium text-text-3 hover:text-text" onClick={() => setShowArchived((v) => !v)}>
                  <ChevronRight size={14} strokeWidth={1.5} className={clsx('transition-transform duration-150', (showArchived || query) && 'rotate-90')} />
                  {fill(t('students.archivedGroup'), { n: archived.length })}
                </button>
              </li>
              {(showArchived || query) && archived.map((p) => <StudentRow key={p.id} s={p} selected={selected === p.id} onClick={() => pick(p.id)} />)}
            </>
          )}
        </ul>
      </div>
      <div className="min-w-0 flex-1 overflow-auto px-8 py-6">
        {adding ? (
          <div className="max-w-md">
            <h1 className="mb-4 text-xl font-semibold">{t('students.add')}</h1>
            {list?.length === 0 && <EmptyState>{t('students.empty')}</EmptyState>}
            <NewStudentForm
              onCancel={() => setAdding(false)}
              onDone={(id) => {
                setAdding(false);
                load();
                onSelect(id);
              }}
            />
          </div>
        ) : selected ? (
          <StudentView
            key={selected}
            id={selected}
            onOpenLesson={(l) => onOpenLesson(selected, l)}
            onOpenSubmission={(s) => onOpenSubmission(selected, s)}
            onListChanged={load}
            onDeleted={() => {
              onSelect(null);
              load();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
