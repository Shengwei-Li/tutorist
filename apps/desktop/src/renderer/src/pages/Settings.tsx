import { Button, Dialog, Field, KeyValue, Panel, Select, StatusMark, TextInput } from '@tutordesk/ui';
import { useEffect, useState } from 'react';
import type { ModelTier } from '@tutordesk/providers/types';
import { AGENTS, API_GATEWAYS, BEAMER_THEMES, UI_SCALES, type AgentMode, type AppSettings, type ApiGateway, type BeamerTheme, type CompileOutcome, type CompileSampleRequest, type VoiceEngine, type VoiceLanguage, type WorkspaceChoice } from '../../../shared/ipc';
import { useT, type TKey } from '../i18n';
import { useAgentStatus } from '../thread/AgentControls';
import { Progress, mb, useSpeechModel } from '../thread/Voice';
import { AGENT_LABEL, fill } from '../thread/labels';
import { PdfFrame } from '../PdfFrame';
import { useHealth, type AiHealth } from '../useHealth';

const GATEWAY_LABEL: Record<ApiGateway, string> = { openrouter: 'OpenRouter', anthropic: 'Anthropic', openai: 'OpenAI', 'openai-compatible': 'OpenAI-compatible endpoint' };
const TIERS: ModelTier[] = ['quality', 'balanced', 'fast'];

function AiStatus({ ai }: { ai: AiHealth | null }) {
  const t = useT();
  if (ai === null) return <StatusMark status="progress">{t('status.checking')}</StatusMark>;
  if (ai.ok) {
    return (
      <StatusMark status="done">
        {t('status.ready')}
        {ai.authMethod ? ` · ${ai.authMethod}` : ''}
        {ai.version ? ` · ${ai.version}` : ''}
      </StatusMark>
    );
  }
  const detail = ai.backend === 'claude-cli' ? (ai.installed ? t('claude.loginHint') : t('claude.installHint')) : ai.detail;
  return (
    <div>
      <StatusMark status="error">{ai.backend === 'claude-cli' ? 'Claude Code' : 'API'}</StatusMark>
      {detail && (
        <p data-testid="ai-detail" className="mt-1 text-sm text-text-2">
          {detail}
        </p>
      )}
    </div>
  );
}

/** Which agent does the work by default, and how much it may do without asking (appendix E.6). */
function Agents({ settings, update }: { settings: AppSettings; update: (p: Partial<AppSettings>) => Promise<void> }) {
  const t = useT();
  const status = useAgentStatus();
  return (
    <Panel title={t('agents.title')}>
      <p className="mb-3 text-sm text-text-2">{t('agents.desc')}</p>
      <div role="radiogroup" className="divide-y divide-border rounded-md border border-border">
        {AGENTS.map((a) => {
          const st = status?.find((s) => s.id === a);
          return (
            <label key={a} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
              <input type="radio" name="agent" data-testid={`default-agent-${a}`} checked={settings.agent === a} onChange={() => void update({ agent: a, aiBackend: a === 'claude-code' ? 'claude-cli' : 'api' })} />
              <span className="w-28 font-medium">{AGENT_LABEL[a]}</span>
              <span className="min-w-0 flex-1 truncate text-text-3">
                {!st ? t('status.checking') : st.ready ? [t('status.ready'), st.version].filter(Boolean).join(' · ') : st.installed ? [t('agents.installed'), st.version].filter(Boolean).join(' · ') : (st.detail ?? t('thread.notReady'))}
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-4 w-72">
        <Field label={t('agents.mode')} hint={t(`thread.modeHint.${settings.agentMode}` as TKey)}>
          <Select data-testid="default-mode" value={settings.agentMode} onChange={(e) => void update({ agentMode: e.target.value as AgentMode })}>
            {(['guarded', 'collaborate', 'full'] as const).map((m) => (
              <option key={m} value={m}>
                {t(`thread.mode.${m}` as TKey)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Panel>
  );
}

function AiConnection({ settings, update, ai, recheck }: { settings: AppSettings; update: (p: Partial<AppSettings>) => Promise<void>; ai: AiHealth | null; recheck: () => void }) {
  const t = useT();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [models, setModels] = useState(settings.api.models);
  const [baseURL, setBaseURL] = useState(settings.api.baseURL ?? '');

  useEffect(() => {
    void window.tutordesk.settings.hasApiKey().then(setHasKey);
  }, [settings.api.gateway]);
  useEffect(() => setModels(settings.api.models), [settings.api.models]);

  const setGateway = async (gateway: ApiGateway) => {
    const defaults = await window.tutordesk.settings.defaultModels(gateway);
    await update({ api: { ...settings.api, gateway, models: defaults } });
    recheck();
  };

  const saveKey = async () => {
    await window.tutordesk.settings.setApiKey(key);
    setKey('');
    setHasKey(await window.tutordesk.settings.hasApiKey());
    recheck();
  };

  const saveModels = async () => {
    await update({ api: { ...settings.api, models, baseURL: baseURL || undefined } });
    recheck();
  };

  return (
    <Panel
      title={t('ai.title')}
      actions={
        <Button data-testid="ai-check" variant="ghost" className="h-7" onClick={recheck}>
          {t('ai.check')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('ai.gateway')}>
            <Select data-testid="ai-gateway" value={settings.api.gateway} onChange={(e) => void setGateway(e.target.value as ApiGateway)}>
              {API_GATEWAYS.map((g) => (
                <option key={g} value={g}>
                  {GATEWAY_LABEL[g]}
                </option>
              ))}
            </Select>
          </Field>
          {settings.api.gateway === 'openai-compatible' && (
            <Field label={t('ai.baseUrl')}>
              <TextInput value={baseURL} placeholder="https://…/v1" onChange={(e) => setBaseURL(e.target.value)} onBlur={saveModels} />
            </Field>
          )}
        </div>
        <Field label={t('ai.key')} hint={hasKey === null ? undefined : hasKey ? t('ai.keySaved') : t('ai.keyMissing')}>
          <div className="flex gap-2">
            <TextInput data-testid="ai-key" type="password" autoComplete="off" className="flex-1" value={key} placeholder={hasKey ? '••••••••' : 'sk-…'} onChange={(e) => setKey(e.target.value)} />
            <Button data-testid="ai-save-key" disabled={!key.trim()} onClick={saveKey}>
              {t('ai.saveKey')}
            </Button>
          </div>
        </Field>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-text-2">{t('ai.models')}</span>
          {TIERS.map((tier) => (
            <div key={tier} className="grid grid-cols-[1fr_1.4fr] items-center gap-3">
              <span className="text-sm text-text-2">{t(`ai.tier.${tier}`)}</span>
              <TextInput className="font-mono text-xs" value={models[tier]} onChange={(e) => setModels({ ...models, [tier]: e.target.value })} onBlur={saveModels} />
            </div>
          ))}
        </div>
        <AiStatus ai={ai} />
      </div>
    </Panel>
  );
}

function Typesetting({ tex, theme, onTheme, onRecheck }: { tex: ReturnType<typeof useHealth>['tex']; theme: BeamerTheme; onTheme: (t: BeamerTheme) => void; onRecheck: () => void }) {
  const t = useT();
  const [doc, setDoc] = useState<CompileSampleRequest['doc']>('handout');
  const [mode, setMode] = useState<CompileSampleRequest['mode']>('student');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<CompileOutcome | null>(null);

  const compile = async () => {
    setBusy(true);
    try {
      setOut(await window.tutordesk.tex.compileSample({ doc, mode, theme }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={t('settings.typesetting')}
      actions={
        <Button variant="ghost" className="h-7" onClick={onRecheck}>
          {t('settings.recheck')}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-text-2">{t('settings.typesetting.desc')}</p>
      <div className="mb-3">
        <StatusMark status={tex === null ? 'progress' : tex.found && !tex.missingFiles.length ? 'done' : 'error'}>
          {tex === null ? t('status.checking') : tex.found ? `${tex.version} · ${tex.kind === 'tectonic' ? t('settings.texBundled') : 'xelatex'}` : t('status.notInstalled')}
        </StatusMark>
        {tex?.missingFiles.length ? (
          <p className="mt-1 text-sm text-danger">
            {t('status.missing')}: {tex.missingFiles.join(', ')}
          </p>
        ) : null}
      </div>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <Field label={t('settings.doc')}>
          <Select data-testid="compile-doc" value={doc} onChange={(e) => setDoc(e.target.value as typeof doc)}>
            <option value="handout">Handout · PEEL</option>
            <option value="worksheet">Worksheet · mixed</option>
            <option value="script">Lesson script</option>
            <option value="deck">Slides · PEEL</option>
          </Select>
        </Field>
        {doc === 'deck' ? (
          <Field label={t('settings.theme')}>
            <Select value={theme} onChange={(e) => onTheme(e.target.value as BeamerTheme)}>
              {BEAMER_THEMES.map((th) => (
                <option key={th} value={th}>
                  {th}
                  {th === 'tutorswiss' ? ' (default)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label={t('settings.mode')}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              {doc === 'worksheet' && <option value="key">Answer key</option>}
            </Select>
          </Field>
        )}
        <div className="flex items-end">
          <Button data-testid="compile" disabled={!tex?.found || busy} onClick={compile}>
            {busy ? t('status.checking') : t('settings.compile')}
          </Button>
        </div>
      </div>
      {out && (
        <div className="mb-3 text-sm">
          <StatusMark status={out.ok ? 'done' : 'error'}>
            <span data-testid="compile-result" data-ok={out.ok} />
            {out.ok ? 'PDF' : 'Failed'} · {(out.durationMs / 1000).toFixed(1)} s{out.engine ? ` · ${out.engine}` : ''}
          </StatusMark>
          {out.errors
            .filter((e) => e.severity === 'error')
            .map((e, i) => (
              <p key={i} className="mt-1 font-mono text-xs text-danger">
                {e.line ? `l.${e.line} ` : ''}
                {e.message}
              </p>
            ))}
        </div>
      )}
      {out?.ok && out.pdf && <PdfFrame pdf={out.pdf} />}
    </Panel>
  );
}

function Voice({ settings, update }: { settings: AppSettings; update: (p: Partial<AppSettings>) => Promise<void> }) {
  const t = useT();
  const m = useSpeechModel();
  const s = m.status;
  const { refresh } = m;
  // Another AI service may or may not take audio.
  useEffect(refresh, [settings.api.gateway, refresh]);
  if (!s) return null;
  const cloud = s.engine === 'cloud';
  return (
    <Panel
      title={t('voice.title')}
      actions={
        cloud ? null : s.state === 'ready' ? (
          <Button variant="ghost" className="h-7 text-danger" onClick={() => void m.uninstall()}>
            {t('voice.remove')}
          </Button>
        ) : s.state === 'downloading' ? (
          <Button variant="ghost" className="h-7" onClick={m.cancel}>
            {t('common.cancel')}
          </Button>
        ) : (
          <Button data-testid="voice-settings-install" className="h-7" onClick={() => void m.install()}>
            {fill(t('voice.download'), { size: mb(s.total) })}
          </Button>
        )
      }
    >
      <div className="mb-3 flex gap-4">
        <div className="w-56">
          <Field label={t('voice.engine')}>
            <Select
              data-testid="voice-engine"
              value={s.engine}
              disabled={s.state === 'downloading'}
              onChange={async (e) => {
                await update({ voiceEngine: e.target.value as VoiceEngine });
                m.refresh();
              }}
            >
              <option value="local">{t('voice.engine.local')}</option>
              <option value="cloud">{t('voice.engine.cloud')}</option>
            </Select>
          </Field>
        </div>
        {!cloud && (
          <div className="w-96">
            <Field label={t('voice.language')}>
              <Select
                data-testid="voice-language"
                value={s.language}
                disabled={s.state === 'downloading'}
                onChange={async (e) => {
                  await update({ voiceLanguage: e.target.value as VoiceLanguage });
                  m.refresh();
                }}
              >
                <option value="english">{t('voice.lang.english')}</option>
                <option value="chinese">{t('voice.lang.chinese')}</option>
              </Select>
            </Field>
          </div>
        )}
      </div>
      {cloud ? (
        <p className="text-sm text-text-2">{t(s.cloud ? 'voice.cloud.ready' : 'voice.cloud.absent')}</p>
      ) : (
        <>
          <p className="text-sm text-text-2">{fill(t(s.state === 'ready' ? 'voice.ready' : 'voice.absent'), { size: mb(s.total) })}</p>
          <p className="mt-1 text-sm text-text-3">{t('voice.memory')}</p>
        </>
      )}
      {s.state === 'downloading' && <Progress done={s.done} total={s.total} />}
      {m.error && <p className="mt-2 text-sm text-danger">{m.error}</p>}
    </Panel>
  );
}

function Studio({ settings, update }: { settings: AppSettings; update: (p: Partial<AppSettings>) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState(settings.studio.name);
  const [mono, setMono] = useState(settings.studio.monogram);
  const [tutor, setTutor] = useState(settings.tutorName);
  const save = () => void update({ studio: { name: name.trim() || settings.studio.name, monogram: mono.trim().slice(0, 3) }, tutorName: tutor.trim() });
  return (
    <Panel title={t('studio.title')}>
      <div className="grid grid-cols-[2fr_1fr_2fr] gap-3">
        <Field label={t('studio.name')}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} onBlur={save} />
        </Field>
        <Field label={t('studio.monogram')}>
          <TextInput value={mono} maxLength={3} onChange={(e) => setMono(e.target.value)} onBlur={save} />
        </Field>
        <Field label={t('studio.tutor')}>
          <TextInput value={tutor} onChange={(e) => setTutor(e.target.value)} onBlur={save} />
        </Field>
      </div>
    </Panel>
  );
}

/**
 * Changing the workspace says what happens to the students: an existing workspace is opened as it is,
 * an empty folder can receive a copy of the current one, and anything else starts afresh there.
 */
function WorkspaceDialog({ choice, onDone, onClose }: { choice: WorkspaceChoice; onDone: (s: AppSettings) => void; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState<'move' | 'switch' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (move: boolean) => {
    setBusy(move ? 'move' : 'switch');
    setError(null);
    try {
      onDone(await window.tutordesk.settings.switchWorkspace(choice.path, move));
      onClose();
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setBusy(null);
    }
  };
  const vars = { path: choice.path, n: choice.currentStudents };
  const canMove = choice.empty && choice.currentStudents > 0;
  return (
    <Dialog
      title={t('settings.ws.title')}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {!choice.inside && (
            <Button variant={canMove ? 'secondary' : 'primary'} disabled={busy !== null} onClick={() => void go(false)}>
              {choice.isWorkspace ? t('settings.ws.open') : t('settings.ws.startNew')}
            </Button>
          )}
          {canMove && (
            <Button variant="primary" disabled={busy !== null} onClick={() => void go(true)}>
              {t('settings.ws.move')}
              {busy === 'move' && '…'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-text-2">
        <code className="font-mono text-xs break-all text-text">{choice.path}</code>
        {choice.inside ? (
          <p>{t('settings.ws.inside')}</p>
        ) : choice.isWorkspace ? (
          <p>{fill(t('settings.ws.openBody'), vars)}</p>
        ) : (
          <>
            {canMove && <p>{fill(t('settings.ws.moveBody'), vars)}</p>}
            {!choice.empty && choice.currentStudents > 0 && <p>{fill(t('settings.ws.notEmpty'), vars)}</p>}
            <p>{t('settings.ws.startBody')}</p>
          </>
        )}
        {error && <p className="text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

export function SettingsPage({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const t = useT();
  const { ai, tex, refresh } = useHealth();
  const update = async (patch: Partial<AppSettings>) => onSettings(await window.tutordesk.settings.update(patch));
  const [wsChoice, setWsChoice] = useState<WorkspaceChoice | null>(null);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-8 py-8">
      <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
      <Panel>
        <div className="flex flex-col gap-4">
          <KeyValue
            items={[
              [
                t('settings.workspace'),
                <span className="flex items-center gap-3">
                  <code className="font-mono text-xs break-all">{settings.workspaceRoot}</code>
                  <Button
                    variant="ghost"
                    className="h-7 shrink-0 whitespace-nowrap"
                    onClick={async () => {
                      const c = await window.tutordesk.settings.pickWorkspace();
                      if (c && !c.same) setWsChoice(c);
                    }}
                  >
                    {t('settings.change')}
                  </Button>
                </span>,
              ],
            ]}
          />
          <div className="flex items-end gap-4">
            <div className="w-48">
              <Field label={t('settings.language')}>
                <Select value={settings.language} onChange={(e) => void update({ language: e.target.value as AppSettings['language'] })}>
                  <option value="en">English</option>
                  <option value="zh">简体中文</option>
                </Select>
              </Field>
            </div>
            <div className="w-36">
              <Field label={t('settings.uiScale')}>
                <Select data-testid="ui-scale" value={String(settings.uiScale ?? 1)} onChange={(e) => void update({ uiScale: Number(e.target.value) })}>
                  {UI_SCALES.map((s) => (
                    <option key={s} value={s}>
                      {Math.round(s * 100)}%
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="flex h-8 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" data-testid="pet-toggle" checked={settings.pet !== false} onChange={(e) => void update({ pet: e.target.checked })} />
              {t('settings.pet')}
            </label>
          </div>
        </div>
      </Panel>
      <Agents settings={settings} update={update} />
      <AiConnection settings={settings} update={update} ai={ai} recheck={() => refresh(true)} />
      {ai !== null && <span data-testid="claude-checked" hidden />}
      <Studio settings={settings} update={update} />
      <Voice settings={settings} update={update} />
      <Typesetting tex={tex} theme={settings.beamerTheme} onTheme={(th) => void update({ beamerTheme: th })} onRecheck={() => refresh(true)} />
      {wsChoice && <WorkspaceDialog choice={wsChoice} onDone={onSettings} onClose={() => setWsChoice(null)} />}
    </div>
  );
}
