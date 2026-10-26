import { Button, Field, KeyValue, Panel, Select, StatusMark, TextInput } from '@tutordesk/ui';
import { useEffect, useState } from 'react';
import type { ModelTier } from '@tutordesk/providers/types';
import { API_GATEWAYS, BEAMER_THEMES, type AppSettings, type ApiGateway, type BeamerTheme, type CompileOutcome, type CompileSampleRequest } from '../../../shared/ipc';
import { useT } from '../i18n';
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
        <div role="radiogroup" className="flex flex-col gap-1.5 text-sm">
          {(['api', 'claude-cli'] as const).map((b) => (
            <label key={b} className="flex items-center gap-2">
              <input
                type="radio"
                name="backend"
                data-testid={`backend-${b}`}
                checked={settings.aiBackend === b}
                onChange={async () => {
                  await update({ aiBackend: b });
                  recheck();
                }}
              />
              {t(b === 'api' ? 'ai.backend.api' : 'ai.backend.cli')}
            </label>
          ))}
        </div>

        {settings.aiBackend === 'api' && (
          <>
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
          </>
        )}
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
          {tex === null ? t('status.checking') : tex.found ? `${tex.version} · ${tex.hasLatexmk ? 'latexmk' : 'xelatex'}` : t('status.notInstalled')}
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

export function SettingsPage({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const t = useT();
  const { ai, tex, refresh } = useHealth();
  const update = async (patch: Partial<AppSettings>) => onSettings(await window.tutordesk.settings.update(patch));

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
                      const s = await window.tutordesk.settings.chooseWorkspace();
                      if (s) onSettings(s);
                    }}
                  >
                    {t('settings.change')}
                  </Button>
                </span>,
              ],
            ]}
          />
          <div className="w-48">
            <Field label={t('settings.language')}>
              <Select value={settings.language} onChange={(e) => void update({ language: e.target.value as AppSettings['language'] })}>
                <option value="en">English</option>
                <option value="zh">简体中文</option>
              </Select>
            </Field>
          </div>
        </div>
      </Panel>
      <AiConnection settings={settings} update={update} ai={ai} recheck={() => refresh(true)} />
      {ai !== null && <span data-testid="claude-checked" hidden />}
      <Studio settings={settings} update={update} />
      <Typesetting tex={tex} theme={settings.beamerTheme} onTheme={(th) => void update({ beamerTheme: th })} onRecheck={() => refresh(true)} />
    </div>
  );
}
