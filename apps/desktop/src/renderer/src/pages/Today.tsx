import { Button, EmptyState, Panel, StatusMark } from '@tutordesk/ui';
import { useEffect, useState } from 'react';
import type { LessonMeta, StudentProfile } from '@tutordesk/core/schemas';
import { useT } from '../i18n';
import { useHealth } from '../useHealth';

function isoDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Row = { profile: StudentProfile; lesson: LessonMeta };

function LessonRows({ rows, onOpen }: { rows: Row[]; onOpen: (r: Row) => void }) {
  const t = useT();
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={`${r.profile.id}/${r.lesson.id}`}>
          <button data-testid={`today-lesson-${r.profile.id}-${r.lesson.number}`} className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-accent" onClick={() => onOpen(r)}>
            <span className="min-w-0 truncate">
              <span className="font-medium">{r.profile.name}</span>
              <span className="text-text-3">
                {' '}
                · L{String(r.lesson.number).padStart(2, '0')} · {r.lesson.minutes} min
              </span>
              {r.lesson.topic && <span> · {r.lesson.topic}</span>}
            </span>
            <StatusMark status={r.lesson.status === 'planned' ? 'pending' : r.lesson.status === 'prepared' ? 'progress' : 'done'}>{t(`lesson.${r.lesson.status}`)}</StatusMark>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TodayPage({ onOpenStudent, onOpenLesson, onOpenSettings }: { onOpenStudent: (id: string | null) => void; onOpenLesson: (studentId: string, lessonId: string) => void; onOpenSettings: () => void }) {
  const t = useT();
  const { ai, tex } = useHealth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasStudents, setHasStudents] = useState(true);

  useEffect(() => {
    void (async () => {
      const list = await window.tutordesk.students.list();
      const from = isoDay(0);
      const to = isoDay(7);
      const out: Row[] = [];
      const active = list.flatMap((s) => (s.ok && !s.profile.archived ? [s.profile] : []));
      setHasStudents(active.length > 0);
      for (const profile of active) {
        const d = await window.tutordesk.students.get(profile.id);
        for (const lesson of d.lessons) if (lesson.date >= from && lesson.date <= to) out.push({ profile, lesson });
      }
      setRows(out.sort((a, b) => a.lesson.date.localeCompare(b.lesson.date) || a.profile.name.localeCompare(b.profile.name)));
    })();
  }, []);

  const ready = ai?.ok && tex?.found && tex.missingFiles.length === 0;
  const lang = document.documentElement.lang;
  const dateLabel = new Date().toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric' });
  const today = isoDay(0);
  const tomorrow = isoDay(1);
  const todays = rows?.filter((r) => r.lesson.date === today) ?? [];
  const later = rows?.filter((r) => r.lesson.date > today) ?? [];
  const days = [...new Set(later.map((r) => r.lesson.date))];
  const dayLabel = (iso: string) => (iso === tomorrow ? t('today.tomorrow') : new Date(`${iso}T00:00:00`).toLocaleDateString(lang, { weekday: 'short', month: 'short', day: 'numeric' }));
  const open = (r: Row) => onOpenLesson(r.profile.id, r.lesson.id);

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">{t('today.title')}</h1>
        <span className="text-sm text-text-3">{dateLabel}</span>
      </header>

      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-4">
          <Panel title={t('student.lessons')}>
            {rows === null ? null : todays.length === 0 ? (
              <EmptyState action={hasStudents ? undefined : <Button onClick={() => onOpenStudent(null)}>{t('today.addStudent')}</Button>}>{t('today.empty')}</EmptyState>
            ) : (
              <LessonRows rows={todays} onOpen={open} />
            )}
          </Panel>
          {rows !== null && (
            <Panel title={t('today.upcoming')}>
              {days.length === 0 ? (
                <p className="text-sm text-text-2">{t('today.noUpcoming')}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {days.map((day) => (
                    <section key={day}>
                      <h3 className="text-xs font-medium text-text-3">{dayLabel(day)}</h3>
                      <LessonRows rows={later.filter((r) => r.lesson.date === day)} onOpen={open} />
                    </section>
                  ))}
                </div>
              )}
            </Panel>
          )}
        </div>

        <Panel title={ready ? t('today.ready') : t('today.notReady')}>
          <div className="flex flex-col gap-2">
            <StatusMark status={ai === null ? 'progress' : ai.ok ? 'done' : 'error'}>
              {ai?.backend === 'claude-cli' ? 'Claude Code' : 'AI'} · {ai === null ? t('status.checking') : ai.ok ? t('status.ready') : ai.backend === 'claude-cli' ? (ai.installed ? t('status.signedOut') : t('status.notInstalled')) : (ai.detail ?? t('status.notInstalled'))}
            </StatusMark>
            <StatusMark status={tex === null ? 'progress' : tex.found && !tex.missingFiles.length ? 'done' : 'error'}>
              LaTeX · {tex === null ? t('status.checking') : tex.found ? (tex.missingFiles.length ? t('status.missing') : tex.version) : t('status.notInstalled')}
            </StatusMark>
            {!ready && ai !== null && tex !== null && (
              <Button variant="ghost" className="mt-1 self-start px-0" onClick={onOpenSettings}>
                {t('nav.settings')} →
              </Button>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
