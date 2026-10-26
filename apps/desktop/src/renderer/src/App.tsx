import clsx from 'clsx';
import { BookOpen, CalendarDays, CheckSquare, LayoutTemplate, Settings as SettingsIcon, Sun, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import type { AppSettings } from '../../shared/ipc';
import { LangProvider, useT } from './i18n';
import { SettingsPage } from './pages/Settings';
import { StudentsPage } from './pages/Students';
import { TodayPage } from './pages/Today';

export type Route = 'today' | 'students' | 'schedule' | 'review' | 'library' | 'templates' | 'settings';

const NAV: { id: Route; icon: ComponentType<{ size?: number; strokeWidth?: number }>; key: Parameters<ReturnType<typeof useT>>[0] }[] = [
  { id: 'today', icon: Sun, key: 'nav.today' },
  { id: 'students', icon: Users, key: 'nav.students' },
  { id: 'schedule', icon: CalendarDays, key: 'nav.schedule' },
  { id: 'review', icon: CheckSquare, key: 'nav.review' },
  { id: 'library', icon: BookOpen, key: 'nav.library' },
  { id: 'templates', icon: LayoutTemplate, key: 'nav.templates' },
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
  const openStudent = useCallback((id: string | null) => {
    setStudentId(id);
    setRoute('students');
  }, []);

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-2 px-2 py-3">
        <div className="mb-4 px-2.5 text-sm font-semibold tracking-tight text-text">TutorDesk</div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavItem key={n.id} id={n.id} active={route === n.id} onClick={() => setRoute(n.id)} icon={n.icon} label={t(n.key)} />
          ))}
        </nav>
        <div className="mt-auto">
          <NavItem id="settings" active={route === 'settings'} onClick={() => setRoute('settings')} icon={SettingsIcon} label={t('nav.settings')} />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        {route === 'today' && <TodayPage onOpenStudent={openStudent} onOpenSettings={() => setRoute('settings')} />}
        {route === 'students' && <StudentsPage selected={studentId} onSelect={setStudentId} />}
        {route === 'settings' && <SettingsPage settings={settings} onSettings={onSettings} />}
        {['schedule', 'review', 'library', 'templates'].includes(route) && (
          <div className="mx-auto max-w-3xl px-8 py-8">
            <h1 className="mb-2 text-xl font-semibold">{t(`nav.${route}` as 'nav.schedule')}</h1>
            <p className="text-sm text-text-2">{t('later.body')}</p>
          </div>
        )}
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
