import clsx from 'clsx';
import { Button, EmptyState, Field, Panel, Select, StatusMark, TextInput } from '@tutordesk/ui';
import { ArrowLeft, FolderOpen, Paperclip } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ArtifactKind, LessonPlan } from '@tutordesk/core/artifacts';
import { BEAMER_THEMES, type BeamerTheme, type CompileOutcome, type EditionMode, type LessonDetail, type QaReportView } from '../../../shared/ipc';
import { useT, type TKey } from '../i18n';
import { PdfFrame } from '../PdfFrame';
import { cleanError, useRun } from '../useRun';

const KINDS: ArtifactKind[] = ['script', 'handout', 'worksheet', 'deck'];
const KIND_LABEL: Record<ArtifactKind, { en: string; zh: string }> = {
  script: { en: 'Script', zh: '底稿' },
  handout: { en: 'Handout', zh: '讲义' },
  worksheet: { en: 'Worksheet', zh: '练习卷' },
  deck: { en: 'Slides', zh: '幻灯片' },
};

function useKindLabel() {
  const zh = document.documentElement.lang.startsWith('zh');
  return (k: ArtifactKind) => (zh ? KIND_LABEL[k].zh : KIND_LABEL[k].en);
}

function QaBar({ qa }: { qa?: QaReportView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!qa) return null;
  const warnings = qa.checks.filter((c) => c.severity === 'warning');
  return (
    <div data-testid="qa" className="rounded-sm border border-border bg-surface px-3 py-2 text-sm">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <StatusMark status={qa.passed ? 'done' : 'error'}>
          {t('lesson.qa')} · {qa.passed ? t('lesson.qaPassed') : t('lesson.qaNeedsYou')}
          {qa.rounds ? ` · ${qa.rounds}×` : ''}
          {warnings.length ? ` · ${warnings.length} ⚠` : ''}
        </StatusMark>
        <span className="text-xs text-text-3">{qa.usd ? `$${qa.usd.toFixed(3)}` : ''} {open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {qa.needsTutor.map((n, i) => (
            <p key={`n${i}`} className="text-danger">
              {n}
            </p>
          ))}
          {warnings.map((c, i) => (
            <p key={`w${i}`} className="text-text-2">
              ⚠ {c.message}
            </p>
          ))}
          {qa.review?.scores.map((s) => (
            <p key={s.criterion} className="text-text-2">
              <span className="font-mono text-xs text-text-3">{s.criterion}</span> {s.score}/5{s.fix ? ` · ${s.fix}` : ''}
            </p>
          ))}
          {qa.review?.overall && <p className="text-text-2 italic">{qa.review.overall}</p>}
        </div>
      )}
    </div>
  );
}

function PlanEditor({ plan, minutes, onChange }: { plan: LessonPlan; minutes: number; onChange: (p: LessonPlan) => void }) {
  const t = useT();
  const total = plan.stages.reduce((a, s) => a + (Number.isFinite(s.minutes) ? s.minutes : 0), 0);
  const setStage = (i: number, patch: Partial<LessonPlan['stages'][number]>) => onChange({ ...plan, stages: plan.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-2">{plan.summary}</p>
      <section>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-text-3 uppercase">{t('lesson.objectives')}</h3>
        <ol className="list-decimal pl-5 text-sm">
          {plan.objectives.map((o) => (
            <li key={o.id}>
              {o.text} <span className="text-text-3">— {o.criterion}</span>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h3 className="mb-1 text-xs font-semibold tracking-wide text-text-3 uppercase">{t('lesson.focusErrors')}</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {plan.focusErrors.map((f, i) => (
            <li key={i}>
              <code className="font-mono text-xs text-text-2">{f.code}</code> <span className="font-serif">{f.evidence}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <div className="mb-1 flex items-baseline justify-between">
          <h3 className="text-xs font-semibold tracking-wide text-text-3 uppercase">{t('lesson.stages')}</h3>
          <span data-testid="plan-total" className={clsx('text-sm tabular-nums', total === minutes ? 'text-text-2' : 'text-danger')}>
            {t('lesson.total')} {total} / {minutes} min
          </span>
        </div>
        <div className="divide-y divide-border rounded-sm border border-border">
          {plan.stages.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[56px_1fr] gap-3 px-3 py-2">
              <TextInput
                type="number"
                min={1}
                max={90}
                className="h-7 w-14 text-right tabular-nums"
                value={Number.isFinite(s.minutes) ? s.minutes : ''}
                onChange={(e) => setStage(i, { minutes: parseInt(e.target.value, 10) })}
              />
              <div className="min-w-0">
                <TextInput className="h-7 w-full font-medium" value={s.title} onChange={(e) => setStage(i, { title: e.target.value })} />
                <p className="mt-1 text-xs text-text-3">
                  {s.phase} · {s.activity}
                  {s.materials.length ? ` · ${s.materials.join(', ')}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
      {plan.homework.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-text-3 uppercase">{t('lesson.homework')}</h3>
          <ul className="list-disc pl-5 text-sm">
            {plan.homework.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ArtifactView({ studentId, lessonId, kind, detail, theme, running, onRevise, onGenerate }: {
  studentId: string;
  lessonId: string;
  kind: ArtifactKind;
  detail: LessonDetail;
  theme: BeamerTheme;
  running: boolean;
  onRevise: (instruction: string) => void;
  onGenerate: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<EditionMode>('student');
  const [deckTheme, setDeckTheme] = useState<BeamerTheme>(theme);
  const [out, setOut] = useState<CompileOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState('');
  const doc = detail.docs[kind];
  const stamp = detail.qa[kind]?.at;

  useEffect(() => {
    if (!doc) return;
    let live = true;
    setBusy(true);
    window.tutordesk.lessons
      .exportPdf(studentId, lessonId, kind, kind === 'deck' ? 'student' : mode, deckTheme)
      .then((r) => live && setOut(r))
      .catch((e) => live && setOut({ ok: false, durationMs: 0, errors: [{ severity: 'error', message: cleanError(e) }] }))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [studentId, lessonId, kind, mode, deckTheme, stamp, doc]);

  if (!doc) {
    return (
      <EmptyState
        action={
          <Button data-testid={`generate-${kind}`} variant="primary" disabled={running || !detail.lesson.planConfirmed} onClick={onGenerate}>
            {t('lesson.generate')}
          </Button>
        }
      >
        {detail.lesson.planConfirmed ? t('lesson.noDoc') : t('lesson.noPlan')}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {kind === 'deck' ? (
          <Field label="Theme">
            <Select value={deckTheme} onChange={(e) => setDeckTheme(e.target.value as BeamerTheme)}>
              {BEAMER_THEMES.map((th) => (
                <option key={th} value={th}>
                  {th}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label={t('lesson.edition')}>
            <Select data-testid="edition" value={mode} onChange={(e) => setMode(e.target.value as EditionMode)}>
              <option value="student">Student</option>
              <option value="teacher">Teacher</option>
              {kind !== 'script' && <option value="key">Answer key</option>}
            </Select>
          </Field>
        )}
        <Button variant="ghost" onClick={() => void window.tutordesk.lessons.revealOutput(studentId, lessonId)}>
          <FolderOpen size={16} strokeWidth={1.5} /> {t('lesson.openFolder')}
        </Button>
        <Button variant="ghost" disabled={running} onClick={onGenerate}>
          {t('lesson.regenerate')}
        </Button>
      </div>
      <QaBar qa={detail.qa[kind]} />
      <div className="flex gap-2">
        <TextInput data-testid="revise-input" className="flex-1" placeholder={t('lesson.revisePlaceholder')} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
        <Button
          disabled={running || !instruction.trim()}
          onClick={() => {
            onRevise(instruction.trim());
            setInstruction('');
          }}
        >
          {t('lesson.revise')}
        </Button>
      </div>
      {busy && <StatusMark status="progress">PDF…</StatusMark>}
      {out && !out.ok && (
        <div className="text-sm text-danger">
          {out.errors.map((e, i) => (
            <p key={i} className="font-mono text-xs">
              {e.line ? `l.${e.line} ` : ''}
              {e.message}
            </p>
          ))}
        </div>
      )}
      {out?.ok && out.pdf && <PdfFrame pdf={out.pdf} className="h-[calc(100vh-260px)] min-h-[520px]" />}
    </div>
  );
}

export function LessonPage({ studentId, lessonId, studentName, theme, onBack }: { studentId: string; lessonId: string; studentName: string; theme: BeamerTheme; onBack: () => void }) {
  const t = useT();
  const kindLabel = useKindLabel();
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [tab, setTab] = useState<'plan' | ArtifactKind>('plan');
  const [draft, setDraft] = useState<LessonPlan | null>(null);
  const [brief, setBrief] = useState('');
  const [outputs, setOutputs] = useState<ArtifactKind[]>(KINDS);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await window.tutordesk.lessons.get(studentId, lessonId);
    setDetail(d);
    setDraft(d.plan);
    setBrief(d.lesson.brief);
    if (d.plan) setOutputs(d.plan.outputs);
  }, [studentId, lessonId]);
  useEffect(() => void load(), [load]);

  const run = useRun(() => void load());

  if (!detail) return null;
  const { lesson } = detail;
  const draftTotal = draft?.stages.reduce((a, s) => a + (Number.isFinite(s.minutes) ? s.minutes : 0), 0) ?? 0;

  const approve = async () => {
    if (!draft) return;
    setError(null);
    try {
      await window.tutordesk.lessons.confirmPlan(studentId, lessonId, { ...draft, outputs });
      await load();
      await run.start(() => window.tutordesk.lessons.generate(studentId, lessonId, outputs));
      setTab(outputs[0] ?? 'plan');
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
          L{String(lesson.number).padStart(2, '0')} · {lesson.date} · {lesson.minutes} min
        </span>
        <span className="ml-auto">
          <StatusMark status={lesson.planConfirmed ? 'done' : detail.plan ? 'progress' : 'pending'}>{lesson.planConfirmed ? t('lesson.approved') : t(`lesson.${lesson.status}` as TKey)}</StatusMark>
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr_280px]">
        {/* context */}
        <aside className="flex flex-col gap-4 overflow-auto border-r border-border p-4">
          <Field label={t('lesson.brief')} hint={t('lesson.briefHint')}>
            <textarea
              data-testid="lesson-brief"
              rows={5}
              className="rounded-sm border border-border-strong bg-surface p-2 text-sm focus:border-accent focus:outline-none"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onBlur={() => brief !== lesson.brief && void window.tutordesk.lessons.setBrief(studentId, lessonId, brief)}
            />
          </Field>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text-2">{t('lesson.materials')}</span>
            {lesson.materials.map((m) => (
              <code key={m} className="truncate font-mono text-xs text-text-2" title={m}>
                {m.split('/').pop()}
              </code>
            ))}
            <Button variant="ghost" className="h-7 self-start px-1" onClick={async () => (await window.tutordesk.lessons.attachMaterial(studentId, lessonId)) && load()}>
              <Paperclip size={14} strokeWidth={1.5} /> {t('lesson.attach')}
            </Button>
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text-2">{t('lesson.outputs')}</span>
            {KINDS.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={outputs.includes(k)} onChange={(e) => setOutputs(e.target.checked ? KINDS.filter((x) => x === k || outputs.includes(x)) : outputs.filter((x) => x !== k))} />
                {kindLabel(k)}
              </label>
            ))}
          </div>
        </aside>

        {/* documents */}
        <section className="flex min-w-0 flex-col overflow-hidden">
          <nav className="flex h-10 shrink-0 items-end gap-1 border-b border-border px-4">
            {(['plan', ...KINDS] as const).map((k) => (
              <button
                key={k}
                data-testid={`tab-${k}`}
                onClick={() => setTab(k)}
                className={clsx('h-9 border-b-2 px-3 text-sm', tab === k ? 'border-accent font-medium text-text' : 'border-transparent text-text-2 hover:text-text')}
              >
                {k === 'plan' ? t('lesson.stages') : kindLabel(k)}
                {k !== 'plan' && detail.docs[k] ? <span className="ml-1 text-text-3">●</span> : null}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {error && <p className="mb-3 text-sm text-danger">{error}</p>}
            {tab === 'plan' ? (
              draft ? (
                <div className="flex max-w-3xl flex-col gap-4">
                  <QaBar qa={detail.qa.plan} />
                  <PlanEditor plan={draft} minutes={lesson.minutes} onChange={setDraft} />
                  <div className="flex gap-2">
                    <Button data-testid="approve-plan" variant="primary" disabled={run.running || draftTotal !== lesson.minutes || !outputs.length} onClick={approve}>
                      {t('lesson.approve')}
                    </Button>
                    <Button disabled={run.running} onClick={() => void run.start(() => window.tutordesk.lessons.plan(studentId, lessonId, { brief, outputs }))}>
                      {t('lesson.replan')}
                    </Button>
                  </div>
                </div>
              ) : (
                <EmptyState
                  action={
                    <Button data-testid="make-plan" variant="primary" disabled={run.running} onClick={() => void run.start(() => window.tutordesk.lessons.plan(studentId, lessonId, { brief, outputs }))}>
                      {t('lesson.makePlan')}
                    </Button>
                  }
                >
                  {t('lesson.noPlan')}
                </EmptyState>
              )
            ) : (
              <ArtifactView
                key={tab}
                studentId={studentId}
                lessonId={lessonId}
                kind={tab}
                detail={detail}
                theme={theme}
                running={run.running}
                onGenerate={() => void run.start(() => window.tutordesk.lessons.generate(studentId, lessonId, [tab]))}
                onRevise={(ins) => void run.start(() => window.tutordesk.lessons.revise(studentId, lessonId, tab, ins))}
              />
            )}
          </div>
        </section>

        {/* progress */}
        <aside className="flex flex-col overflow-hidden border-l border-border">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-sm font-semibold">{t('lesson.progress')}</span>
            {run.running && (
              <Button variant="ghost" className="h-7" onClick={run.cancel}>
                {t('common.stop')}
              </Button>
            )}
          </div>
          <div data-testid="run-log" className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
            {run.lines.map((l, i) => (
              <div key={i} className={l.tone === 'error' ? 'text-danger' : l.tone === 'muted' ? 'text-text-3' : 'text-text-2'}>
                {l.text}
              </div>
            ))}
            {run.error && <div className="text-danger">{run.error}</div>}
            {run.running && <div className="text-accent">◐</div>}
          </div>
          {run.usd > 0 && <div className="border-t border-border px-4 py-2 text-xs text-text-3 tabular-nums">${run.usd.toFixed(3)}</div>}
        </aside>
      </div>
    </div>
  );
}
