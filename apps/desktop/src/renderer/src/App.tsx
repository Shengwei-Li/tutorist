import clsx from 'clsx';
import { Settings as SettingsIcon, Sun, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import type { AppSettings } from '../../shared/ipc';
import { LangProvider, useT } from './i18n';
import { LessonPage } from './pages/Lesson';
import { SettingsPage } from './pages/Settings';
import { StudentsPage } from './pages/Students';
import { SubmissionPage } from './pages/Submission';
import { TodayPage } from './pages/Today';
import { Pet } from './Pet';

export type Route = 'today' | 'students' | 'settings';

// Schedule, review, library and templates come back here when they do something (SPEC milestones).
const NAV: { id: Route; icon: ComponentType<{ size?: number; strokeWidth?: number }>; key: Parameters<ReturnType<typeof useT>>[0] }[] = [
  { id: 'today', icon: Sun, key: 'nav.today' },
  { id: 'students', icon: Users, key: 'nav.students' },
];

function NavItem({ id, active, onClick, icon: Icon, label }: { id: Route; active: boolean; onClick: () => void; icon: (typeof NAV)[number]['icon']; label: string }) {
  return (
    <button
      data-testid={`nav-${id}`}
      onClick={onClick}
      className={clsx(
        'flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-150',
        active ? 'bg-surface text-text font-medium shadow-[inset_0_0_0_1px_var(--border)]' : 'text-text-2 hover:bg-surface hover:text-text',
      )}
    >
      <Icon size={16} strokeWidth={1.5} />
      {label}
    </button>
  );
}

function Shell({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const t = useT();
  const [route, setRoute] = useState<Route>('today');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ kind: 'lesson' | 'submission'; studentId: string; id: string; studentName: string } | null>(null);
  const openStudent = useCallback((id: string | null) => {
    setStudentId(id);
    setDetail(null);
    setRoute('students');
  }, []);
  const openDetail = useCallback(async (kind: 'lesson' | 'submission', sid: string, id: string) => {
    const d = await window.tutordesk.students.get(sid);
    setStudentId(sid);
    setRoute('students');
    setDetail({ kind, studentId: sid, id, studentName: d.profile.name });
  }, []);

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-2 px-2 py-3">
        <div className="mb-4 px-2.5 text-sm font-semibold tracking-tight text-text">TutorDesk</div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavItem
              key={n.id}
              id={n.id}
              active={route === n.id}
              onClick={() => {
                setDetail(null);
                setRoute(n.id);
              }}
              icon={n.icon}
              label={t(n.key)}
            />
          ))}
        </nav>
        <div className="mt-auto">
          {settings.pet !== false && <Pet />}
          <NavItem
            id="settings"
            active={route === 'settings'}
            onClick={() => {
              setDetail(null);
              setRoute('settings');
            }}
            icon={SettingsIcon}
            label={t('nav.settings')}
          />
        </div>
      </aside>
      <main className={clsx('min-w-0 flex-1', detail ? 'overflow-hidden' : 'overflow-auto')}>
        {route === 'today' && <TodayPage onOpenStudent={openStudent} onOpenLesson={(s, l) => void openDetail('lesson', s, l)} onOpenSettings={() => setRoute('settings')} />}
        {route === 'students' && detail?.kind === 'lesson' && (
          <LessonPage key={detail.id} studentId={detail.studentId} lessonId={detail.id} studentName={detail.studentName} theme={settings.beamerTheme} onBack={() => setDetail(null)} />
        )}
        {route === 'students' && detail?.kind === 'submission' && (
          <SubmissionPage key={detail.id} studentId={detail.studentId} subId={detail.id} studentName={detail.studentName} onBack={() => setDetail(null)} />
        )}
        {route === 'students' && !detail && (
          <StudentsPage
            selected={studentId}
            onSelect={setStudentId}
            onOpenLesson={(s, l) => void openDetail('lesson', s, l)}
            onOpenSubmission={(s, x) => void openDetail('submission', s, x)}
          />
        )}
        {route === 'settings' && <SettingsPage settings={settings} onSettings={onSettings} />}
      </main>
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    void window.tutordesk.settings.get().then(setSettings);
  }, []);
  useEffect(() => {
    if (settings) document.documentElement.lang = settings.language === 'zh' ? 'zh-CN' : 'en';
  }, [settings]);
  if (!settings) return null;
  return (
    <LangProvider lang={settings.language}>
      <Shell settings={settings} onSettings={setSettings} />
    </LangProvider>
  );
}
