import clsx from 'clsx';
import { Button, EmptyState, Field, KeyValue, Panel, Select, StatusMark, TextInput } from '@tutordesk/ui';
import { FolderOpen, Plus } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ExamId } from '@tutordesk/core/schemas';
import type { StudentDetail, StudentSummary } from '../../../shared/ipc';
import { useT } from '../i18n';

const EXAMS: { id: ExamId; label: string; step: number; min: number; max: number; def: number }[] = [
  { id: 'ielts-academic', label: 'IELTS Academic', step: 0.5, min: 0, max: 9, def: 6.5 },
  { id: 'ielts-general', label: 'IELTS General Training', step: 0.5, min: 0, max: 9, def: 6.5 },
  { id: 'pte-academic', label: 'PTE Academic', step: 1, min: 10, max: 90, def: 65 },
  { id: 'pte-core', label: 'PTE Core', step: 1, min: 10, max: 90, def: 65 },
];

const examLabel = (id: ExamId) => EXAMS.find((e) => e.id === id)?.label ?? id;

function NewStudentForm({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [exam, setExam] = useState<ExamId>('ielts-academic');
  const spec = EXAMS.find((e) => e.id === exam)!;
  const [target, setTarget] = useState(String(spec.def));
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await window.tutordesk.students.create({ name: name.trim(), exam, targetOverall: Number(target), examDate: date || undefined });
      onDone(p.id);
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': /, ''));
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

function StudentView({ id }: { id: string }) {
  const t = useT();
  const [d, setD] = useState<StudentDetail | null>(null);
  const [topic, setTopic] = useState('');
  const load = useCallback(() => void window.tutordesk.students.get(id).then(setD), [id]);
  useEffect(load, [load]);
  if (!d) return null;
  const p = d.profile;

  const addLesson = async () => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await window.tutordesk.students.createLesson(id, { date, topic: topic.trim() || undefined });
    setTopic('');
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{p.name}</h1>
          <p className="mt-1 text-sm text-text-2">
            {examLabel(p.goal.exam)} · {p.goal.targetOverall}
            {p.goal.examDates[0] ? ` · ${p.goal.examDates[0]}` : ''}
          </p>
        </div>
        <Button variant="ghost" onClick={() => void window.tutordesk.students.reveal(id)}>
          <FolderOpen size={16} strokeWidth={1.5} /> {t('student.openFolder')}
        </Button>
      </header>

      <Panel title={t('student.profile')}>
        <KeyValue
          items={[
            [t('profile.id'), <code className="font-mono text-xs">{p.id}</code>],
            [t('profile.schedule'), `${t('profile.perWeek')} ${p.delivery.sessionsPerWeek} × ${p.delivery.minutesPerSession} min · ${p.delivery.mode}`],
            [t('profile.gloss'), p.glossLanguage],
            [t('profile.folder'), <code className="font-mono text-xs break-all">{d.dir}</code>],
          ]}
        />
      </Panel>

      <Panel
        title={t('student.lessons')}
        actions={
          <div className="flex items-center gap-2">
            <TextInput data-testid="lesson-topic" placeholder={t('student.topic')} value={topic} onChange={(e) => setTopic(e.target.value)} className="h-7 w-48" />
            <Button data-testid="lesson-create" onClick={addLesson} className="h-7">
              <Plus size={14} strokeWidth={1.5} /> {t('student.newLesson')}
            </Button>
          </div>
        }
      >
        {d.lessons.length === 0 ? (
          <p className="text-sm text-text-2">{t('student.noLessons')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {d.lessons.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="font-medium tabular-nums">L{String(l.number).padStart(2, '0')}</span>
                  <span className="text-text-3"> · {l.date} · {l.minutes} min</span>
                  {l.topic && <span> · {l.topic}</span>}
                </span>
                <StatusMark status={l.status === 'planned' ? 'pending' : 'done'}>{t(`lesson.${l.status}`)}</StatusMark>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('student.errors')}>
          {d.errors.filter((e) => e.status !== 'resolved').length === 0 ? (
            <p className="text-sm text-text-2">{t('student.noErrors')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {d.errors
                .filter((e) => e.status !== 'resolved')
                .slice(0, 8)
                .map((e) => (
                  <li key={e.id}>
                    <code className="font-mono text-xs text-text-2">{e.code}</code> <span className="font-serif">{e.excerpt}</span>
                  </li>
                ))}
            </ul>
          )}
        </Panel>
        <Panel title={t('student.history')}>
          <ul className="flex flex-col gap-1 text-sm">
            {d.history.map((c) => (
              <li key={c.hash} className="flex gap-3">
                <code className="font-mono text-xs text-text-3">{c.hash}</code>
                <span className="truncate">{c.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

export function StudentsPage({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const t = useT();
  const [list, setList] = useState<StudentSummary[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => void window.tutordesk.students.list().then(setList), []);
  useEffect(load, [load]);

  useEffect(() => {
    if (list && list.length === 0) setAdding(true);
  }, [list]);

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <h1 className="text-sm font-semibold">{t('students.title')}</h1>
          <Button variant="ghost" className="h-7 px-2" onClick={() => setAdding(true)} aria-label={t('students.add')}>
            <Plus size={16} strokeWidth={1.5} />
          </Button>
        </div>
        <ul className="flex-1 overflow-auto py-1">
          {list?.map((s) =>
            s.ok ? (
              <li key={s.profile.id}>
                <button
                  onClick={() => {
                    setAdding(false);
                    onSelect(s.profile.id);
                  }}
                  className={clsx(
                    'flex h-10 w-full flex-col justify-center px-4 text-left',
                    selected === s.profile.id ? 'bg-accent-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="text-sm font-medium leading-tight">{s.profile.name}</span>
                  <span className="text-xs leading-tight text-text-3">
                    {examLabel(s.profile.goal.exam)} · {s.profile.goal.targetOverall}
                  </span>
                </button>
              </li>
            ) : (
              <li key={s.id} className="px-4 py-2 text-sm">
                <span className="font-medium">{s.id}</span>
                <span className="block text-xs text-danger" title={s.issues.join('\n')}>
                  {t('students.invalid')}
                </span>
              </li>
            ),
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
          <StudentView key={selected} id={selected} />
        ) : null}
      </div>
    </div>
  );
}
