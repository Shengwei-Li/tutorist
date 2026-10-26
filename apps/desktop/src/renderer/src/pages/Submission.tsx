import clsx from 'clsx';
import { Button, Field, Panel, Select, StatusMark, TextInput } from '@tutordesk/ui';
import { ArrowLeft } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AnchoredAnnotationView, SubmissionDetail } from '../../../shared/ipc';
import { useT } from '../i18n';
import { cleanError, useRun } from '../useRun';

const BANDS = Array.from({ length: 19 }, (_, i) => i / 2);

/** Annotation kinds are told apart by line style as well as colour (black-and-white safe, SPEC §8.3 ④). */
const MARK: Record<AnchoredAnnotationView['kind'], string> = {
  grammar: 'underline decoration-wavy decoration-[var(--anno-grammar)] underline-offset-4',
  lexis: 'underline decoration-solid decoration-[var(--anno-lexis)] underline-offset-4',
  cohesion: 'underline decoration-dashed decoration-[var(--anno-cohesion)] underline-offset-4',
  task: 'underline decoration-dotted decoration-2 decoration-[var(--anno-task)] underline-offset-4',
};

function AnnotatedEssay({ text, annotations, active, onPick }: { text: string; annotations: AnchoredAnnotationView[]; active: number | null; onPick: (i: number) => void }) {
  const parts = useMemo(() => {
    const spans = annotations.filter((a) => a.start !== null && a.end !== null).sort((a, b) => a.start! - b.start!);
    const out: ReactNode[] = [];
    let pos = 0;
    for (const a of spans) {
      if (a.start! < pos) continue; // skip overlaps; the note is still listed on the right
      out.push(<Fragment key={`t${pos}`}>{text.slice(pos, a.start!)}</Fragment>);
      out.push(
        <span key={`a${a.index}`} onClick={() => onPick(a.index)} className={clsx('cursor-pointer', MARK[a.kind], active === a.index && 'bg-accent-soft')}>
          {text.slice(a.start!, a.end!)}
          <sup className="ml-0.5 font-sans text-[10px] text-text-3">{a.index + 1}</sup>
        </span>,
      );
      pos = a.end!;
    }
    out.push(<Fragment key="tail">{text.slice(pos)}</Fragment>);
    return out;
  }, [text, annotations, active, onPick]);
  return <div data-testid="essay" className="font-serif text-[15px] leading-[1.8] whitespace-pre-wrap">{parts}</div>;
}

export function SubmissionPage({ studentId, subId, studentName, onBack }: { studentId: string; subId: string; studentName: string; onBack: () => void }) {
  const t = useT();
  const [d, setD] = useState<SubmissionDetail | null>(null);
  const [text, setText] = useState('');
  const [prompt, setPrompt] = useState('');
  const [final, setFinal] = useState<Record<string, number>>({});
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const x = await window.tutordesk.submissions.get(studentId, subId);
    setD(x);
    setText(x.text);
    setPrompt(x.meta.prompt);
    if (x.review) {
      const f: Record<string, number> = {};
      for (const c of x.review.review.criteria) f[c.id] = x.meta.finalBands[c.id] ?? c.low;
      setFinal(f);
      setAccepted(new Set(x.review.annotations.filter((a) => a.start !== null).map((a) => a.index)));
    }
  }, [studentId, subId]);
  useEffect(() => void load(), [load]);
  const run = useRun(() => void load());

  if (!d) return null;
  const { meta, review } = d;
  const needsConfirm = !meta.textConfirmed;

  const confirm = async () => {
    setError(null);
    try {
      await window.tutordesk.submissions.confirmText(studentId, subId, text, prompt);
      await load();
    } catch (e) {
      setError(cleanError(e));
    }
  };

  const finalise = async () => {
    setError(null);
    try {
      await window.tutordesk.submissions.finalise(studentId, subId, final, [...accepted]);
      await load();
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Button variant="ghost" className="h-7 px-2" onClick={onBack} aria-label={t('common.back')}>
          <ArrowLeft size={16} strokeWidth={1.5} />
        </Button>
        <span className="text-sm text-text-2">{studentName}</span>
        <span className="text-text-3">/</span>
        <span className="text-sm font-medium">
          {meta.kind === 'writing-task1' ? 'Task 1' : 'Task 2'} · {meta.id.slice(0, 10)}
          {review ? ` · ${review.wordCount} ${t('writing.words')}` : ''}
        </span>
        <span className="ml-auto">
          <StatusMark status={meta.status === 'finalised' ? 'done' : meta.status === 'reviewed' ? 'progress' : 'pending'}>{meta.status === 'finalised' ? t('writing.finalised') : t(`writing.status.${meta.status}` as 'writing.status.new')}</StatusMark>
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_400px]">
        <section className="overflow-auto px-10 py-8">
          {error && <p className="mb-3 text-sm text-danger">{error}</p>}
          {needsConfirm ? (
            <div className="flex flex-col gap-4">
              {d.image && <img src={d.image} alt="" className="max-h-[420px] self-start rounded-sm border border-border object-contain" />}
              <p className="text-sm text-text-2">{t('writing.confirmHint')}</p>
              <Field label={t('writing.prompt')}>
                <TextInput value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </Field>
              <Field label={t('writing.text')}>
                <textarea data-testid="essay-text" rows={16} className="rounded-sm border border-border-strong bg-surface p-3 font-serif text-[15px] leading-relaxed focus:border-accent focus:outline-none" value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                {meta.source === 'image' && (
                  <Button disabled={run.running} onClick={() => void run.start(() => window.tutordesk.submissions.transcribe(studentId, subId))}>
                    {t('writing.transcribe')}
                  </Button>
                )}
                <Button variant="primary" disabled={!text.trim() || run.running} onClick={confirm}>
                  {t('writing.confirm')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl">
              {meta.prompt && <p className="mb-5 text-sm text-text-2 italic">{meta.prompt}</p>}
              {review ? <AnnotatedEssay text={d.text} annotations={review.annotations} active={active} onPick={setActive} /> : <div className="font-serif text-[15px] leading-[1.8] whitespace-pre-wrap">{d.text}</div>}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-4 overflow-auto border-l border-border p-4">
          {!needsConfirm && (
            <div className="flex gap-2">
              <Button data-testid="review-essay" variant={review ? 'secondary' : 'primary'} disabled={run.running} onClick={() => void run.start(() => window.tutordesk.submissions.review(studentId, subId))}>
                {review ? t('writing.rereview') : t('writing.review')}
              </Button>
              {run.running && (
                <Button variant="ghost" onClick={run.cancel}>
                  {t('common.stop')}
                </Button>
              )}
            </div>
          )}
          {(run.running || run.error) && (
            <div className="font-mono text-xs text-text-3">
              {run.lines.slice(-4).map((l, i) => (
                <div key={i} className={l.tone === 'error' ? 'text-danger' : ''}>
                  {l.text}
                </div>
              ))}
              {run.error && <div className="text-danger">{run.error}</div>}
            </div>
          )}
          {review && (
            <>
              <Panel>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-text-3">
                      <th className="pb-2 font-medium" />
                      <th className="pb-2 font-medium">{t('writing.ai')}</th>
                      <th className="pb-2 font-medium">{t('writing.final')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.review.criteria.map((c) => (
                      <tr key={c.id} title={c.evidence.join(' / ')}>
                        <td className="py-1 font-medium">{c.id}</td>
                        <td className="py-1 tabular-nums text-text-2">
                          {c.low === c.high ? c.low : `${c.low}–${c.high}`}
                        </td>
                        <td className="py-1">
                          <Select className="h-7 w-20" value={final[c.id] ?? c.low} onChange={(e) => setFinal({ ...final, [c.id]: Number(e.target.value) })}>
                            {BANDS.map((b) => (
                              <option key={b} value={b}>
                                {b.toFixed(1)}
                              </option>
                            ))}
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {review.issues.length > 0 && <p className="mt-2 text-xs text-warning">{review.issues.join(' ')}</p>}
              </Panel>

              <Panel title={t('writing.top')}>
                <ol className="flex flex-col gap-2 text-sm">
                  {review.review.topIssues.map((x, i) => (
                    <li key={i}>
                      <span className="font-medium">
                        {i + 1}. {x.title}
                      </span>
                      <span className="block text-text-2">{x.why}</span>
                      <span className="block">→ {x.action}</span>
                    </li>
                  ))}
                </ol>
              </Panel>

              <Panel title={`${t('writing.notes')} · ${review.annotations.length}`}>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {review.annotations.map((a) => (
                    <li key={a.index} className={clsx('py-2', active === a.index && 'bg-accent-soft')} onMouseEnter={() => setActive(a.index)}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-3 tabular-nums">{a.index + 1}</span>
                        <code className="font-mono text-xs text-text-2">{a.code}</code>
                        <span className="ml-auto flex items-center gap-1 text-xs text-text-3">
                          <input
                            type="checkbox"
                            aria-label={t('writing.accept')}
                            checked={accepted.has(a.index)}
                            onChange={(e) => {
                              const next = new Set(accepted);
                              if (e.target.checked) next.add(a.index);
                              else next.delete(a.index);
                              setAccepted(next);
                            }}
                          />
                        </span>
                      </div>
                      <p className="mt-1 font-serif">
                        <span className="line-through decoration-text-3">{a.quote}</span> → {a.suggestion}
                      </p>
                      <p className="text-xs text-text-2">{a.explanation}</p>
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel title={t('writing.rewrite')}>
                <p className="font-serif text-sm text-text-2 line-through decoration-text-3">{review.review.rewrite.original}</p>
                <p className="mt-2 font-serif text-sm">{review.review.rewrite.improved}</p>
                <p className="mt-2 text-xs text-text-3">{review.review.rewrite.note}</p>
              </Panel>

              <Panel title={t('writing.next')}>
                <p className="text-sm">{review.review.nextTask}</p>
              </Panel>

              <Button data-testid="finalise" variant="primary" disabled={run.running} onClick={finalise}>
                {t('writing.finalise')}
              </Button>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
