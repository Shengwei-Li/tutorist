import { Button, EmptyState, Panel, StatusMark } from '@tutordesk/ui';
import { useEffect, useState } from 'react';
import type { LessonMeta, StudentProfile } from '@tutordesk/core/schemas';
import { useT } from '../i18n';
import { useHealth } from '../useHealth';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function TodayPage({ onOpenStudent, onOpenSettings }: { onOpenStudent: (id: string | null) => void; onOpenSettings: () => void }) {
  const t = useT();
  const { ai, tex } = useHealth();
  const [rows, setRows] = useState<{ profile: StudentProfile; lesson: LessonMeta }[] | null>(null);

  useEffect(() => {
    void (async () => {
      const list = await window.tutordesk.students.list();
      const today = todayIso();
      const out: { profile: StudentProfile; lesson: LessonMeta }[] = [];
      for (const s of list) {
        if (!s.ok) continue;
        const d = await window.tutordesk.students.get(s.profile.id);
        for (const lesson of d.lessons) if (lesson.date === today) out.push({ profile: s.profile, lesson });
      }
      setRows(out);
    })();
  }, []);

  const ready = ai?.ok && tex?.found && tex.missingFiles.length === 0;
  const dateLabel = new Date().toLocaleDateString(document.documentElement.lang, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">{t('today.title')}</h1>
        <span className="text-sm text-text-3">{dateLabel}</span>
      </header>

      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <Panel title={t('student.lessons')}>
          {rows === null ? null : rows.length === 0 ? (
            <EmptyState action={<Button onClick={() => onOpenStudent(null)}>{t('today.addStudent')}</Button>}>{t('today.empty')}</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map(({ profile, lesson }) => (
                <li key={`${profile.id}/${lesson.id}`}>
                  <button className="flex w-full items-center justify-between py-2 text-left text-sm hover:text-accent" onClick={() => onOpenStudent(profile.id)}>
                    <span>
                      <span className="font-medium">{profile.name}</span>
                      <span className="text-text-3"> · L{lesson.number} {lesson.topic}</span>
                    </span>
                    <StatusMark status={lesson.status === 'planned' ? 'pending' : 'done'}>{t(`lesson.${lesson.status}`)}</StatusMark>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

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
