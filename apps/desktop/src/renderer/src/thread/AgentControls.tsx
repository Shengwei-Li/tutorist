import clsx from 'clsx';
import { ChevronDown, Lock, LockOpen, ShieldQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AGENTS, type AgentId, type AgentMode, type AgentModels, type AgentStatus, type CliAgentId } from '../../../shared/ipc';
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

/** The agent's own model list (asked of the agent by the main process, which remembers it). */
export function useAgentModels(agent: AgentId): { list: AgentModels | null; failed: boolean } {
  const [state, setState] = useState<{ agent: AgentId; list: AgentModels | null; failed: boolean }>({ agent, list: null, failed: false });
  useEffect(() => {
    if (agent === 'api') return;
    let live = true;
    setState({ agent, list: null, failed: false });
    window.tutordesk.agents.models(agent).then(
      (list) => live && setState({ agent, list, failed: false }),
      () => live && setState({ agent, list: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [agent]);
  return state.agent === agent ? state : { list: null, failed: false };
}

/** The options of a model select: the default first, then the agent's models, then a stored id it no longer lists. */
export function ModelOptions({ list, failed, value, defaultName }: { list: AgentModels | null; failed: boolean; value: string; defaultName?: string }) {
  const t = useT();
  const def = defaultName ?? list?.defaultLabel;
  return (
    <>
      <option value="">{def ? `${t('thread.model.default')} · ${def}` : t('thread.model.default')}</option>
      {list?.models.map((m) => (
        <option key={m.id} value={m.id} title={m.description}>
          {m.label}
        </option>
      ))}
      {value && !list?.models.some((m) => m.id === value) && <option value={value}>{value}</option>}
      {!list && (
        <option value="" disabled>
          {failed ? t('thread.model.failed') : t('thread.model.loading')}
        </option>
      )}
    </>
  );
}

/** Which model this conversation's agent uses; switching takes effect from the next message. */
function ModelPicker({ agent, model, defaultModel, disabled, onChange }: { agent: CliAgentId; model?: string; defaultModel?: string; disabled?: boolean; onChange: (model: string | null) => void }) {
  const t = useT();
  const { list, failed } = useAgentModels(agent);
  const name = (id: string) => list?.models.find((m) => m.id === id)?.label ?? id;
  return (
    <label className="relative flex h-[30px] min-w-0 max-w-[160px] items-center gap-1 whitespace-nowrap rounded-md px-2 text-[13px] text-text-2 hover:bg-surface-2" title={t('thread.model')}>
      <span className="truncate">{model ? name(model) : t('thread.model.default')}</span>
      <ChevronDown size={14} strokeWidth={1.6} className="shrink-0 text-text-3" />
      <select
        aria-label={t('thread.model')}
        data-testid="agent-model"
        disabled={disabled}
        value={model ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <ModelOptions list={list} failed={failed} value={model ?? ''} defaultName={defaultModel && name(defaultModel)} />
      </select>
    </label>
  );
}

const MODE_ICON = { guarded: Lock, collaborate: ShieldQuestion, full: LockOpen } as const;

/** Agent switch, model and permission mode for one thread (appendix E.6). OpenCode shows only when installed. */
export function AgentControls({
  agent,
  mode,
  model,
  defaultModel,
  disabled,
  compact,
  onChange,
}: {
  agent: AgentId;
  mode: AgentMode;
  model?: string;
  defaultModel?: string;
  disabled?: boolean;
  /** A narrow side panel: the permission mode shows as its icon (its name is in the tooltip). */
  compact?: boolean;
  onChange: (p: { agent?: AgentId; mode?: AgentMode; model?: string | null }) => void;
}) {
  const t = useT();
  const status = useAgentStatus();
  const shown = AGENTS.filter((a) => a !== 'opencode' || agent === 'opencode' || status?.find((s) => s.id === 'opencode')?.ready);
  const ModeIcon = MODE_ICON[mode];
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div role="radiogroup" aria-label="Agent" className="flex shrink-0 gap-0.5 rounded-md border border-border p-0.5">
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
                'h-[26px] whitespace-nowrap rounded-[4px] px-2.5 text-[13px] transition-colors disabled:cursor-not-allowed',
                agent === a ? 'bg-surface-2 font-medium text-text' : 'text-text-2 hover:text-text',
                unavailable && agent !== a && 'text-text-3',
              )}
            >
              {AGENT_LABEL[a]}
            </button>
          );
        })}
      </div>
      {agent !== 'api' && <ModelPicker agent={agent} model={model} defaultModel={defaultModel} disabled={disabled} onChange={(m) => onChange({ model: m })} />}
      <label
        className="relative flex h-[30px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[13px] text-text-2 hover:bg-surface-2"
        title={compact ? `${t(`thread.mode.${mode}` as TKey)}: ${t(`thread.modeHint.${mode}` as TKey)}` : t(`thread.modeHint.${mode}` as TKey)}
      >
        <ModeIcon size={14} strokeWidth={1.6} />
        {!compact && t(`thread.mode.${mode}` as TKey)}
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
