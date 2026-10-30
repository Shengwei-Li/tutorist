import clsx from 'clsx';
import { Button, Select, StatusMark } from '@tutordesk/ui';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ArtifactKind, LessonPlan } from '@tutordesk/core/artifacts';
import { BEAMER_THEMES, type BeamerTheme, type CompileOutcome, type EditionMode, type LessonDetail, type QaReportView } from '../../../shared/ipc';
import { useT } from '../i18n';
import { PdfFrame } from '../PdfFrame';
import { AgentControls } from '../thread/AgentControls';
import { AGENT_LABEL, fill, kindLabel } from '../thread/labels';
import { ThreadPanel, type Recipe } from '../thread/ThreadPanel';
import { useThread } from '../thread/useThread';
import { cleanError } from '../useRun';

const KINDS: ArtifactKind[] = ['script', 'handout', 'worksheet', 'deck'];

const byLabel = (by?: string) => (by ? (AGENT_LABEL[by as keyof typeof AGENT_LABEL] ?? (by.startsWith('api:') ? by.slice(4) : by)) : undefined);

/** Check results, folded: what is wrong first, scores on demand. */
function QaBar({ qa }: { qa?: QaReportView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!qa) return null;
  const warnings = qa.checks.filter((c) => c.severity === 'warning');
  const problems = qa.needsTutor.length;
  return (
    <div data-testid="qa" className="rounded-lg border border-border bg-surface text-[13px]">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen((o) => !o)}>
        {qa.passed ? <Check size={14} strokeWidth={1.75} className="text-positive" /> : <AlertTriangle size={14} strokeWidth={1.75} className="text-warning" />}
        <span className={qa.passed ? 'text-text-2' : 'text-warning'}>
          {qa.passed ? t('lesson.qaPassed') : `${t('lesson.qaNeedsYou')} · ${problems}`}
          {warnings.length ? <span className="text-text-3"> · {fill(t('lesson.notes'), { n: warnings.length, s: warnings.length === 1 ? '' : 's' })}</span> : null}
        </span>
        <ChevronDown size={14} strokeWidth={1.6} className={clsx('ml-auto text-text-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2.5">
          {qa.needsTutor.map((n, i) => (
            <p key={`n${i}`} className="text-warning">
              {n}
            </p>
          ))}
          {warnings.map((c, i) => (
            <p key={`w${i}`} className="text-text-2">
              {c.message}
            </p>
          ))}
          {qa.review?.scores.map((s) => (
            <p key={s.criterion} className="text-text-2">
              <span className="font-mono text-[12px] text-text-3">{s.criterion}</span> {s.score}/5{s.fix ? ` · ${s.fix}` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-border px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-[12px] font-medium text-text-3">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The plan card as the tutor reviews it: point, objectives with pass marks, timed stages, target errors. */
function PlanCard({ plan, minutes, onChange }: { plan: LessonPlan; minutes: number; onChange: (p: LessonPlan) => void }) {
  const t = useT();
  const total = plan.stages.reduce((a, s) => a + (Number.isFinite(s.minutes) ? s.minutes : 0), 0);
  const setStage = (i: number, patch: Partial<LessonPlan['stages'][number]>) => onChange({ ...plan, stages: plan.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="rounded-lg border border-border bg-surface">
      <h3 className="px-4 pt-4 text-[16px] font-semibold tracking-tight">{plan.title}</h3>
      <p className="px-4 pt-1 pb-3.5 text-[13px] leading-relaxed text-text-2">{plan.summary}</p>
      <Section title={t('lesson.objectives')}>
        <ol className="flex flex-col gap-2">
          {plan.objectives.map((o, i) => (
            <li key={o.id} className="grid grid-cols-[18px_1fr] gap-x-2 text-[13px]">
              <span className="text-text-3 tabular-nums">{i + 1}</span>
              <span>{o.text}</span>
              <span className="col-start-2 text-[12px] text-text-3">{o.criterion}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Section
        title={t('lesson.stages')}
        aside={
          <span data-testid="plan-total" className={clsx('text-[12px] tabular-nums', total === minutes ? 'text-text-3' : 'text-danger')}>
            {total} / {minutes} min
          </span>
        }
      >
        <div className="flex flex-col">
          {plan.stages.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[44px_1fr] items-baseline gap-2.5 border-b border-dashed border-border py-1.5 last:border-b-0">
              <input
                aria-label={`${s.title} minutes`}
                type="number"
                min={1}
                max={90}
                value={Number.isFinite(s.minutes) ? s.minutes : ''}
                onChange={(e) => setStage(i, { minutes: parseInt(e.target.value, 10) })}
                className="h-6 w-11 rounded-sm bg-transparent text-right text-[13px] text-text-3 tabular-nums outline-none hover:bg-surface-2 focus:bg-surface-2 focus:text-text"
              />
              <div className="min-w-0">
                <input
                  aria-label="Stage title"
                  value={s.title}
                  onChange={(e) => setStage(i, { title: e.target.value })}
                  className="w-full rounded-sm bg-transparent text-[13px] outline-none hover:bg-surface-2 focus:bg-surface-2"
                />
                <p className="text-[12px] leading-snug text-text-3">
                  {s.activity}
                  {s.materials.length ? ` · ${s.materials.map((m) => kindLabel(m, true)).join(', ')}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title={t('lesson.focusErrors')}>
        <ul className="flex flex-col gap-1.5">
          {plan.focusErrors.map((f, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr] gap-2.5 text-[13px]">
              <code className="font-mono text-[12px] text-text-3">{f.code}</code>
              <span className="text-text-2">{f.evidence}</span>
            </li>
          ))}
        </ul>
      </Section>
      {plan.homework.length > 0 && (
        <Section title={t('lesson.homework')}>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-text-2 marker:text-text-3">
            {plan.homework.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function ArtifactView({ studentId, lessonId, kind, detail, theme }: { studentId: string; lessonId: string; kind: ArtifactKind; detail: LessonDetail; theme: BeamerTheme }) {
  const t = useT();
  const [mode, setMode] = useState<EditionMode>('student');
  const [deckTheme, setDeckTheme] = useState<BeamerTheme>(theme);
  const [out, setOut] = useState<CompileOutcome | null>(null);
  const [busy, setBusy] = useState(false);
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

  if (!doc) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {kind === 'deck' ? (
          <Select aria-label="Theme" className="h-8 text-[13px]" value={deckTheme} onChange={(e) => setDeckTheme(e.target.value as BeamerTheme)}>
            {BEAMER_THEMES.map((th) => (
              <option key={th} value={th}>
                {th}
              </option>
            ))}
          </Select>
        ) : (
          <Select aria-label={t('lesson.edition')} data-testid="edition" className="h-8 text-[13px]" value={mode} onChange={(e) => setMode(e.target.value as EditionMode)}>
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
            {kind !== 'script' && <option value="key">Answer key</option>}
          </Select>
        )}
        {busy && <StatusMark status="progress">PDF</StatusMark>}
        <Button variant="ghost" className="ml-auto h-8 text-[13px]" onClick={() => void window.tutordesk.lessons.revealOutput(studentId, lessonId)}>
          <FolderOpen size={15} strokeWidth={1.5} /> {t('lesson.openFolder')}
        </Button>
      </div>
      <QaBar qa={detail.qa[kind]} />
      {out && !out.ok && (
        <div className="text-[13px] text-danger">
          {out.errors.map((e, i) => (
            <p key={i} className="font-mono text-[12px]">
              {e.line ? `l.${e.line} ` : ''}
              {e.message}
            </p>
          ))}
        </div>
      )}
      {out?.ok && out.pdf && <PdfFrame pdf={out.pdf} className="h-[calc(100vh-190px)] min-h-[480px] rounded-lg border border-border" />}
    </div>
  );
}

function TabMark({ qa, has }: { qa?: QaReportView; has: boolean }) {
  if (!has || !qa) return null;
  if (qa.passed) return <Check size={13} strokeWidth={2} className="text-positive" aria-label="passed" />;
  return <span className="text-[12px] font-medium text-warning tabular-nums">{qa.needsTutor.length || '!'}</span>;
}

/**
 * The lesson workbench (appendix E.9): the conversation with the agent in the middle, what it
 * produces on the right, and the tutor's own gate, approving the plan, on the plan card.
 */
export function LessonPage({ studentId, lessonId, studentName, theme, onBack }: { studentId: string; lessonId: string; studentName: string; theme: BeamerTheme; onBack: () => void }) {
  const t = useT();
  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [tab, setTab] = useState<'plan' | ArtifactKind>('plan');
  const [draft, setDraft] = useState<LessonPlan | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justApproved, setJustApproved] = useState(false);

  const load = useCallback(async () => {
    const d = await window.tutordesk.lessons.get(studentId, lessonId);
    setDetail(d);
    setDirty((wasDirty) => {
      if (!wasDirty) setDraft(d.plan);
      return wasDirty;
    });
  }, [studentId, lessonId]);
  useEffect(() => void load(), [load]);

  const subject = useMemo(() => ({ type: 'lesson' as const, studentId, lessonId }), [studentId, lessonId]);
  const thread = useThread(subject, () => void load());
  const agent = thread.view?.agent ?? 'api';

  const approved = detail?.lesson.planConfirmed ?? false;
  const recipes: Recipe[] = [
    { id: 'plan', label: t('recipe.plan'), text: t('recipe.planText') },
    { id: 'materials', label: t('recipe.materials'), text: t('recipe.materialsText'), disabled: !approved, hint: approved ? undefined : t('panel.approveFirst') },
    { id: 'easier', label: t('recipe.easier'), text: fill(t('recipe.easierText'), { doc: tab === 'plan' ? kindLabel('worksheet', true) : kindLabel(tab, true) }), prefill: true, disabled: !detail || !Object.keys(detail.docs).length },
  ];

  if (!detail) return null;
  const { lesson } = detail;
  const total = draft?.stages.reduce((a, s) => a + (Number.isFinite(s.minutes) ? s.minutes : 0), 0) ?? 0;
  const planBy = byLabel(detail.qa.plan?.by);

  const approve = async () => {
    if (!draft) return;
    setError(null);
    try {
      await window.tutordesk.lessons.confirmPlan(studentId, lessonId, draft);
      setDirty(false);
      setJustApproved(!approved);
      await load();
    } catch (e) {
      setError(cleanError(e));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <Button variant="ghost" className="h-7 px-2" onClick={onBack} aria-label={t('common.back')}>
          <ArrowLeft size={16} strokeWidth={1.5} />
        </Button>
        <p className="min-w-0 truncate text-[13px] text-text-3">
          {studentName} / <span className="font-medium text-text">L{String(lesson.number).padStart(2, '0')}{lesson.topic ? ` · ${lesson.topic}` : ''}</span> · {lesson.date} · {lesson.minutes} min
        </p>
        <div className="ml-auto">{thread.view && <AgentControls agent={agent} mode={thread.view.mode} model={thread.view.model} defaultModel={thread.view.defaultModel} disabled={thread.running} onChange={(p) => void thread.configure(p)} />}</div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(420px,1fr)_minmax(400px,40%)]">
        <ThreadPanel thread={thread} agent={agent} recipes={recipes} onAttach={() => window.tutordesk.threads.attach(studentId)} />

        <aside className="flex min-h-0 flex-col border-l border-border bg-bg">
          <nav className="flex h-11 shrink-0 items-end gap-1 border-b border-border px-3">
            {(['plan', ...KINDS] as const).map((k) => (
              <button
                key={k}
                data-testid={`tab-${k}`}
                onClick={() => setTab(k)}
                className={clsx('-mb-px flex h-10 items-center gap-1.5 border-b-2 px-2.5 text-[13px]', tab === k ? 'border-text font-medium text-text' : 'border-transparent text-text-3 hover:text-text')}
              >
                {k === 'plan' ? t('lesson.plan') : kindLabel(k)}
                {k === 'plan' ? approved && <Check size={13} strokeWidth={2} className="text-positive" /> : <TabMark qa={detail.qa[k]} has={!!detail.docs[k]} />}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {error && <p className="mb-3 text-[13px] text-danger">{error}</p>}
            {tab === 'plan' &&
              (draft ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-[13px] text-text-2">
                    {approved ? <Check size={15} strokeWidth={1.75} className="text-positive" /> : <span className="h-2 w-2 rounded-full border border-warning" />}
                    <span>
                      <span className="font-medium text-text">{approved ? t('panel.approvedBy') : t('panel.waiting')}</span>
                      {planBy && <span className="text-text-3"> · {fill(t('panel.writtenBy'), { by: planBy })}</span>}
                    </span>
                  </div>
                  {!detail.qa.plan?.passed && <QaBar qa={detail.qa.plan} />}
                  <PlanCard
                    plan={draft}
                    minutes={lesson.minutes}
                    onChange={(p) => {
                      setDraft(p);
                      setDirty(true);
                      setJustApproved(false);
                    }}
                  />
                  {(!approved || dirty) && (
                    <div className="flex items-center gap-3">
                      <Button data-testid="approve-plan" variant="primary" disabled={total !== lesson.minutes || thread.running} onClick={approve}>
                        {approved ? t('panel.saveChanges') : t('panel.approve')}
                      </Button>
                      {total !== lesson.minutes && <span className="text-[12px] text-danger tabular-nums">{total} / {lesson.minutes} min</span>}
                    </div>
                  )}
                  {justApproved && approved && !dirty && (
                    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-[13px]">
                      <span className="text-text-2">{t('panel.afterApprove')}</span>
                      <Button data-testid="write-materials" className="ml-auto h-8 text-[13px]" disabled={thread.running} onClick={() => void thread.send(t('recipe.materialsText'))}>
                        {t('recipe.materials')}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3 pt-10 text-[14px] leading-relaxed text-text-3">
                  <p className="max-w-sm">{t('panel.noPlan')}</p>
                  <Button data-testid="make-plan" disabled={thread.running} onClick={() => void thread.send(t('recipe.planText'))}>
                    {t('recipe.plan')}
                  </Button>
                </div>
              ))}
            {tab !== 'plan' &&
              (detail.docs[tab] ? (
                <ArtifactView key={tab} studentId={studentId} lessonId={lessonId} kind={tab} detail={detail} theme={theme} />
              ) : (
                <div className="flex flex-col items-start gap-3 pt-10 text-[14px] text-text-3">
                  <p>{approved ? t('panel.notWritten') : t('panel.approveFirst')}</p>
                  {approved && (
                    <Button data-testid={`write-${tab}`} disabled={thread.running} onClick={() => void thread.send(fill(t('recipe.oneText'), { doc: kindLabel(tab, true) }))}>
                      {t('panel.writeIt')}
                    </Button>
                  )}
                </div>
              ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
