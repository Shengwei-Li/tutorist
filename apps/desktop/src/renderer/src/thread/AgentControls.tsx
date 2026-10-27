import clsx from 'clsx';
import { ChevronDown, Lock, LockOpen, ShieldQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AGENTS, type AgentId, type AgentMode, type AgentStatus } from '../../../shared/ipc';
import { useT, type TKey } from '../i18n';
import { AGENT_LABEL } from './labels';

let statusCache: Promise<AgentStatus[]> | null = null;

/** Which agents are installed and signed in; checked once per app session. */
export function useAgentStatus(): AgentStatus[] | null {
  const [s, setS] = useState<AgentStatus[] | null>(null);
  useEffect(() => {
    statusCache ??= window.tutordesk.agents.status();
    let live = true;
    void statusCache.then((v) => live && setS(v));
    return () => {
      live = false;
    };
  }, []);
  return s;
}

const MODE_ICON = { guarded: Lock, collaborate: ShieldQuestion, full: LockOpen } as const;

/** Agent switch and permission mode for one thread (appendix E.6). OpenCode shows only when installed. */
export function AgentControls({ agent, mode, disabled, onChange }: { agent: AgentId; mode: AgentMode; disabled?: boolean; onChange: (p: { agent?: AgentId; mode?: AgentMode }) => void }) {
  const t = useT();
  const status = useAgentStatus();
  const shown = AGENTS.filter((a) => a !== 'opencode' || agent === 'opencode' || status?.find((s) => s.id === 'opencode')?.ready);
  const ModeIcon = MODE_ICON[mode];
  return (
    <div className="flex items-center gap-2">
      <div role="radiogroup" aria-label="Agent" className="flex gap-0.5 rounded-md border border-border p-0.5">
        {shown.map((a) => {
          const st = status?.find((s) => s.id === a);
          // Installed but sign-in unknown (OpenCode) still works if the tutor signed in: allow it.
          const unavailable = st ? !st.ready && !st.installed : false;
          return (
            <button
              key={a}
              role="radio"
              aria-checked={agent === a}
              data-testid={`agent-${a}`}
              disabled={disabled || (unavailable && agent !== a)}
              title={unavailable ? (st?.detail ?? t('thread.notReady')) : st?.version ? `${AGENT_LABEL[a]} ${st.version}` : AGENT_LABEL[a]}
              onClick={() => agent !== a && onChange({ agent: a })}
              className={clsx(
                'h-[26px] rounded-[4px] px-2.5 text-[13px] transition-colors disabled:cursor-not-allowed',
                agent === a ? 'bg-surface-2 font-medium text-text' : 'text-text-2 hover:text-text',
                unavailable && agent !== a && 'text-text-3',
              )}
            >
              {AGENT_LABEL[a]}
            </button>
          );
        })}
      </div>
      <label className="relative flex h-[30px] items-center gap-1.5 rounded-md px-2 text-[13px] text-text-2 hover:bg-surface-2" title={t(`thread.modeHint.${mode}` as TKey)}>
        <ModeIcon size={14} strokeWidth={1.6} />
        {t(`thread.mode.${mode}` as TKey)}
        <ChevronDown size={14} strokeWidth={1.6} className="text-text-3" />
        <select
          aria-label="Permissions"
          data-testid="agent-mode"
          disabled={disabled}
          value={mode}
          onChange={(e) => onChange({ mode: e.target.value as AgentMode })}
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {(['guarded', 'collaborate', 'full'] as const).map((m) => (
            <option key={m} value={m}>
              {t(`thread.mode.${m}` as TKey)} — {t(`thread.modeHint.${m}` as TKey)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
