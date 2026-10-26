import { Button, Field, KeyValue, Panel, Select, StatusMark } from '@tutordesk/ui';
import { useEffect, useRef, useState } from 'react';
import type { AgentEvent } from '@tutordesk/providers/types';
import { BEAMER_THEMES, type AppSettings, type BeamerTheme, type CompileOutcome, type CompileSampleRequest, type TestRunResult } from '../../../shared/ipc';
import { useT } from '../i18n';
import { useHealth } from '../useHealth';

type RunEvent = AgentEvent | { type: 'finished'; result: TestRunResult };

function eventLine(ev: RunEvent): string | null {
  switch (ev.type) {
    case 'init':
      return `session ${ev.sessionId.slice(0, 8)} · ${ev.model ?? ''}`;
    case 'tool_call':
      return `tool ${ev.name}`;
    case 'usage':
      return `tokens in ${ev.inputTokens} · out ${ev.outputTokens} · cache ${ev.cacheRead}${ev.usd !== undefined ? ` · $${ev.usd.toFixed(4)}` : ''}`;
    case 'error':
      return `error: ${ev.message}`;
    case 'done':
      return 'done';
    case 'policy_violation':
      return `blocked write: ${ev.path}`;
    default:
      return null;
  }
}

function AiConnection({ claude, onRecheck }: { claude: ReturnType<typeof useHealth>['claude']; onRecheck: () => void }) {
  const t = useT();
  const [runId, setRunId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [result, setResult] = useState<TestRunResult | null>(null);
  const runRef = useRef<string | null>(null);

  useEffect(
    () =>
      window.tutordesk.agent.onEvent((id, ev) => {
        if (id !== runRef.current) return;
        if (ev.type === 'text_delta') setText((s) => s + ev.text);
        if (ev.type === 'finished') {
          setResult(ev.result);
          setRunId(null);
          runRef.current = null;
          return;
        }
        const line = eventLine(ev);
        if (line) setLog((l) => [...l, line]);
      }),
    [],
  );

  const start = async () => {
    setLog([]);
    setText('');
    setResult(null);
    const id = await window.tutordesk.agent.testRun();
    runRef.current = id;
    setRunId(id);
  };

  return (
    <Panel
      title={t('settings.ai')}
      actions={
        <Button variant="ghost" className="h-7" onClick={onRecheck}>
          {t('settings.recheck')}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-text-2">{t('settings.ai.desc')}</p>
      <div className="mb-3">
        <StatusMark status={claude === null ? 'progress' : claude.ok ? 'done' : 'error'}>
          Claude Code{claude?.version ? ` ${claude.version}` : ''} ·{' '}
          {claude === null ? t('status.checking') : claude.ok ? `${t('status.ready')} (${claude.authMethod ?? 'signed in'})` : claude.installed ? t('status.signedOut') : t('status.notInstalled')}
        </StatusMark>
        {claude && !claude.ok && <p className="mt-1 text-sm text-text-2">{claude.installed ? t('claude.loginHint') : t('claude.installHint')}</p>}
        {claude !== null && <span data-testid="claude-checked" />}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={!claude?.ok || runId !== null} onClick={start}>
          {t('settings.ai.test')}
        </Button>
        {runId && (
          <Button variant="ghost" onClick={() => void window.tutordesk.agent.cancel(runId)}>
            {t('settings.ai.cancel')}
          </Button>
        )}
      </div>
      {(log.length > 0 || text || result) && (
        <div className="mt-3 rounded-sm border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-text-2">
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
          {result && (
            <pre className={`mt-2 whitespace-pre-wrap ${result.ok ? 'text-text' : 'text-danger'}`}>
              {result.ok ? JSON.stringify(result.value, null, 2) : `${result.error}${result.issues ? `\n${result.issues.join('\n')}` : ''}`}
            </pre>
          )}
        </div>
      )}
    </Panel>
  );
}

function Typesetting({ tex, theme, onTheme, onRecheck }: { tex: ReturnType<typeof useHealth>['tex']; theme: BeamerTheme; onTheme: (t: BeamerTheme) => void; onRecheck: () => void }) {
  const t = useT();
  const [doc, setDoc] = useState<CompileSampleRequest['doc']>('handout');
  const [mode, setMode] = useState<CompileSampleRequest['mode']>('student');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<CompileOutcome | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const compile = async () => {
    setBusy(true);
    try {
      const r = await window.tutordesk.tex.compileSample({ doc, mode, theme });
      setOut(r);
      if (r.pdf) setUrl(URL.createObjectURL(new Blob([r.pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })));
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
        {tex?.missingFiles.length ? <p className="mt-1 text-sm text-danger">{t('status.missing')}: {tex.missingFiles.join(', ')}</p> : null}
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
            {out.ok ? 'PDF' : 'Failed'} · {(out.durationMs / 1000).toFixed(1)} s · {out.engine}
          </StatusMark>
          {out.errors.filter((e) => e.severity === 'error').map((e, i) => (
            <p key={i} className="mt-1 font-mono text-xs text-danger">
              {e.line ? `l.${e.line} ` : ''}
              {e.message}
            </p>
          ))}
        </div>
      )}
      {url && out?.ok && <iframe title="PDF preview" src={url} className="h-[640px] w-full rounded-sm border border-border bg-white" />}
    </Panel>
  );
}

export function SettingsPage({ settings, onSettings }: { settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const t = useT();
  const { claude, tex, refresh } = useHealth();
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
      <AiConnection claude={claude} onRecheck={() => refresh(true)} />
      <Typesetting tex={tex} theme={settings.beamerTheme} onTheme={(th) => void update({ beamerTheme: th })} onRecheck={() => refresh(true)} />
    </div>
  );
}
