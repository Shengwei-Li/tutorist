import clsx from 'clsx';
import { AlertTriangle, ArrowUp, Check, Paperclip, Square, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AgentId } from '../../../shared/ipc';
import { useT } from '../i18n';
import { AGENT_LABEL, fill, stepLabel } from './labels';
import type { Approval, Block, ThreadState } from './useThread';

export interface Recipe {
  id: string;
  label: string;
  /** Sent as is, or placed in the composer for the tutor to finish when `prefill` is set. */
  text: string;
  prefill?: boolean;
  disabled?: boolean;
  hint?: string;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Inline **bold** and `code`; everything else is plain text (agent output is never HTML). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-medium">{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={i} className="rounded-sm bg-surface-2 px-1 font-mono text-[12px] text-text-2">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** A small, safe Markdown subset: paragraphs, bullet and numbered lists, headings as bold lines. */
function Prose({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2.5 text-[14px] leading-relaxed text-text">
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]!);
          const List = ordered ? 'ol' : 'ul';
          return (
            <List key={i} className={clsx('flex flex-col gap-1 pl-5', ordered ? 'list-decimal' : 'list-disc marker:text-text-3')}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>
              ))}
            </List>
          );
        }
        if (/^#{1,4}\s/.test(b)) return <p key={i} className="font-medium">{inline(b.replace(/^#+\s*/, ''))}</p>;
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** "NOT passed", "Not saved", "fix these": the tool worked but the document needs another round. */
const needsWork = (summary?: string) => !!summary && /not passed|not saved|fix these|does not pass/i.test(summary);

function Step({ block }: { block: Extract<Block, { kind: 'tool' }> }) {
  const t = useT();
  const warn = block.status === 'error' || needsWork(block.summary);
  const detail =
    warn && block.summary
      ? block.summary
          .replace(/^.*?(NOT passed|Not saved)[^:]*:?\s*/i, '')
          .replace(/^-?\s*\[(error|warning)\]\s*/i, '')
          .split('\n')[0]
      : undefined;
  return (
    <div className={clsx('flex items-baseline gap-2.5 py-[3px] text-[13px]', warn ? 'text-warning' : 'text-text-2')}>
      <span className="relative top-[2px] w-3.5 shrink-0">
        {block.status === 'running' ? (
          <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-border-strong border-t-text-2" />
        ) : warn ? (
          <AlertTriangle size={14} strokeWidth={1.75} />
        ) : (
          <Check size={14} strokeWidth={1.75} className="text-text-3" />
        )}
      </span>
      <span className="min-w-0">
        {stepLabel(t, block.name, block.target)}
        {detail && <span className="text-text-3"> — {detail.slice(0, 140)}</span>}
      </span>
    </div>
  );
}

function ApprovalCard({ a, onAnswer }: { a: Approval; onAnswer: (d: 'allow' | 'deny') => void }) {
  const t = useT();
  return (
    <div data-testid="approval" className="mt-3 rounded-lg border border-border-strong bg-surface px-4 py-3">
      <p className="text-[14px] font-medium">{a.title}</p>
      {a.detail && <p className="mt-0.5 text-[13px] text-text-2">{a.detail}</p>}
      <div className="mt-3 flex gap-2">
        <button data-testid="approval-allow" className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover" onClick={() => onAnswer('allow')}>
          {t('thread.allow')}
        </button>
        <button className="h-8 rounded-md border border-border-strong px-3 text-[13px] font-medium hover:bg-surface-2" onClick={() => onAnswer('deny')}>
          {t('thread.deny')}
        </button>
      </div>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return <>{s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`}</>;
}

/** The conversation column: log, approvals, quick instructions, composer. */
export function ThreadPanel({
  thread,
  agent,
  recipes,
  onAttach,
  empty,
  extra,
  placeholder,
  narrow,
}: {
  thread: ThreadState;
  agent: AgentId;
  recipes: Recipe[];
  onAttach?: () => Promise<string[]>;
  empty?: ReactNode;
  /** Cards that belong to this conversation (e.g. AI proposals), shown after the log. */
  extra?: ReactNode;
  placeholder?: string;
  /** In a side panel: less padding. */
  narrow?: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { blocks, running, pending } = thread;

  // Follow the conversation while it grows, unless the tutor scrolled up to read.
  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [blocks, pending, extra]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  // Until the conversation has loaded there is nowhere to send to: keep the draft.
  const ready = !!thread.view;
  const submit = () => {
    if (!draft.trim() || running || !ready) return;
    void thread.send(draft);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const applyRecipe = (r: Recipe) => {
    if (r.prefill) {
      setDraft(r.text);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(r.text.length, r.text.length);
      });
    } else void thread.send(r.text);
  };

  // A header ("Claude Code · 21:04") opens each run of agent output.
  let lastRole: 'tutor' | 'agent' | null = null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div ref={logRef} data-testid="thread-log" className="min-h-0 flex-1 overflow-y-auto">
        <div className={clsx('mx-auto max-w-[680px] pb-3', narrow ? 'px-5 pt-5' : 'px-7 pt-7')}>
          {!blocks.length && <div className={clsx('text-center text-[14px] leading-relaxed text-text-3', narrow ? 'px-2 pt-10' : 'pt-16')}>{empty ?? t('thread.empty')}</div>}
          {blocks.map((b, i) => {
            const role = b.kind === 'tutor' ? 'tutor' : 'agent';
            const header = role !== lastRole;
            lastRole = role;
            const gap = header && i > 0 ? 'mt-6' : '';
            if (b.kind === 'tutor')
              return (
                <div key={i} className={gap}>
                  <p className="mb-1.5 text-[12px] text-text-3">
                    {t('thread.you')} · {time(b.at)}
                  </p>
                  <div className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap">{b.text}</div>
                </div>
              );
            return (
              <div key={i} className={gap}>
                {header && (
                  <p className="mb-1.5 text-[12px] text-text-3">
                    {AGENT_LABEL[(b.kind === 'agent' && b.by) || agent]} · {time(b.at)}
                  </p>
                )}
                {b.kind === 'agent' && (
                  <div className="py-1">
                    <Prose text={b.text} />
                  </div>
                )}
                {b.kind === 'tool' && (
                  <div className="border-l border-border pl-3.5">
                    <Step block={b} />
                  </div>
                )}
                {b.kind === 'system' && <p className={clsx('py-1 text-[13px]', b.tone === 'warning' ? 'text-warning' : 'text-text-3')}>{b.text}</p>}
              </div>
            );
          })}
          {extra}
          {pending.map((a) => (
            <ApprovalCard key={a.requestId} a={a} onAnswer={(d) => thread.respond(a.requestId, d)} />
          ))}
          {running && !pending.length && (
            <div className="mt-3 flex items-center gap-1.5 text-[13px] text-text-3" aria-live="polite">
              <span className="flex gap-1">
                {[0, 1, 2].map((n) => (
                  <span key={n} className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-3" style={{ animationDelay: `${n * 150}ms` }} />
                ))}
              </span>
            </div>
          )}
          {thread.error && (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-danger">
              <X size={14} strokeWidth={1.75} /> {thread.error}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 pb-4">
        <div className={clsx('mx-auto max-w-[680px]', narrow ? 'px-5' : 'px-7')}>
          <div className={clsx('flex flex-wrap gap-1.5', recipes.length > 0 && 'mb-2')}>
            {recipes.map((r) => (
              <button
                key={r.id}
                data-testid={`recipe-${r.id}`}
                title={r.hint}
                disabled={running || !ready || r.disabled}
                onClick={() => applyRecipe(r)}
                className="h-7 rounded-md border border-border px-2.5 text-[13px] text-text-2 transition-colors hover:border-border-strong hover:text-text disabled:pointer-events-none disabled:opacity-45"
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="rounded-lg border border-border-strong bg-surface shadow-float focus-within:border-text-3">
            <textarea
              ref={inputRef}
              data-testid="thread-input"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              placeholder={placeholder ?? fill(t('thread.placeholder'), { agent: AGENT_LABEL[agent] })}
              className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14px] leading-relaxed text-text outline-none placeholder:text-text-3"
            />
            <div className="flex items-center gap-1 px-2 pt-1 pb-2">
              {onAttach && (
                <button
                  aria-label={t('thread.attach')}
                  title={t('thread.attach')}
                  className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text"
                  onClick={async () => {
                    const files = await onAttach();
                    if (files.length) setDraft((d) => `${d}${d && !d.endsWith('\n') ? '\n' : ''}${t('recipe.importText')}\n${files.map((f) => `- ${f}`).join('\n')}\n`);
                  }}
                >
                  <Paperclip size={16} strokeWidth={1.5} />
                </button>
              )}
              {running && thread.startedAt && (
                <span className="ml-1 text-[12px] text-text-3 tabular-nums">
                  {t('thread.working')} · <Elapsed since={thread.startedAt} />
                  {thread.usd > 0 && ` · $${thread.usd.toFixed(3)}`}
                </span>
              )}
              {running ? (
                <button data-testid="thread-stop" onClick={thread.interrupt} className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium hover:bg-surface-2">
                  <Square size={12} strokeWidth={2} /> {t('common.stop')}
                </button>
              ) : (
                <button
                  data-testid="thread-send"
                  aria-label={t('thread.send')}
                  disabled={!draft.trim() || !ready}
                  onClick={submit}
                  className="ml-auto grid h-8 w-8 place-items-center rounded-md bg-accent text-accent-fg hover:bg-accent-hover disabled:bg-surface-2 disabled:text-text-3"
                >
                  <ArrowUp size={16} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
