import clsx from 'clsx';
import { Button } from '@tutordesk/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { draftProfile, mergeProfile, type Proposal, type ProposedLesson, type ProposedStudent, type StudentProfile } from '@tutordesk/core/schemas';
import type { AppliedProposal, ProfilePatch } from '../../../shared/ipc';
import { useT, type TKey } from '../i18n';
import { fill } from '../thread/labels';
import { ProfileDialog, SKILLS, SKILL_LABEL, cleanError, examLabel, languageName, zh } from './profile';

/** Pending proposals for a student (or new-student proposals), reloaded on demand. */
export function useProposals(filter: { studentId?: string; kind?: Proposal['kind'] }) {
  const [list, setList] = useState<Proposal[]>([]);
  const key = JSON.stringify(filter);
  const reload = useCallback(() => {
    void window.tutordesk.proposals
      .list(JSON.parse(key) as typeof filter)
      .then(setList)
      .catch(() => setList([]));
  }, [key]);
  useEffect(reload, [reload]);
  return { list, reload };
}

/** The profile as lines a tutor reads; the card compares these before and after. */
function facts(t: (k: TKey) => string, p: StudentProfile): [string, string][] {
  const skills = SKILLS.filter((s) => p.goal.targetBySkill[s] !== undefined).map((s) => `${zh() ? SKILL_LABEL[s].zh : SKILL_LABEL[s].en} ${p.goal.targetBySkill[s]}`);
  const parent = p.parent ? [p.parent.name, p.parent.contact, p.parent.cadence].filter(Boolean).join(' · ') : '';
  return [
    [t('students.name'), p.name],
    [t('profile.exam'), examLabel(p.goal.exam)],
    [t('students.target'), String(p.goal.targetOverall)],
    [t('profile.skillTargets'), skills.join(' · ')],
    [t('profile.examDate'), p.goal.examDates.join(', ')],
    [t('profile.purpose'), p.goal.purpose ?? ''],
    [t('profile.levels'), p.levels.map((l) => `${l.dimension} ${l.value}`).join(' · ')],
    [t('profile.section.lessons'), fill(t('profile.scheduleValue'), { n: p.delivery.sessionsPerWeek, m: p.delivery.minutesPerSession, mode: t(`mode.${p.delivery.mode}` as TKey) }) + (p.delivery.format === 'small-group' ? ` · ${t('format.small-group')}` : '')],
    [t('profile.age'), p.ageOrGrade ?? ''],
    [t('profile.firstLanguage'), languageName(p.firstLanguage)],
    [t('profile.gloss'), t(`gloss.${p.glossLanguage}` as TKey)],
    [t('profile.interests'), p.interests.join(zh() ? '、' : ', ')],
    [t('profile.style'), p.learningStyle ?? ''],
    [t('profile.parent'), parent],
  ];
}

/** The tutor's edits in the profile editor, as the new student they describe. */
function toStudent(x: ProfilePatch, base: ProposedStudent): ProposedStudent {
  return {
    ...base,
    name: x.name ?? base.name,
    exam: x.goal?.exam ?? base.exam,
    targetOverall: x.goal?.targetOverall ?? base.targetOverall,
    examDate: x.goal?.examDates?.[0],
    targetBySkill: x.goal?.targetBySkill,
    purpose: x.goal?.purpose,
    delivery: x.delivery,
    ageOrGrade: x.ageOrGrade,
    firstLanguage: x.firstLanguage,
    glossLanguage: x.glossLanguage,
    interests: x.interests,
    learningStyle: x.learningStyle,
    parent: x.parent,
  };
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00`).toLocaleDateString(document.documentElement.lang, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * One AI proposal: what would change, and the tutor's confirm, edit or dismiss. Nothing is written
 * until Confirm; Edit opens the usual profile editor filled with the proposal.
 */
export function ProposalCard({ p, current, threadId, onDone }: { p: Proposal; current?: StudentProfile; threadId?: string; onDone: (r: AppliedProposal | null) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [skip, setSkip] = useState<Set<number>>(new Set());

  const { after, invalid } = useMemo(() => {
    try {
      if (p.kind === 'student') return { after: draftProfile(p.student) };
      if (p.kind === 'profile' && current) return { after: mergeProfile(current, p.changes) };
      return { after: current };
    } catch (e) {
      return { after: undefined, invalid: (e as Error).message.split('\n')[0] };
    }
  }, [p, current]);

  const lessons: ProposedLesson[] = p.kind === 'profile' ? [] : p.lessons;
  const kept = lessons.filter((_, i) => !skip.has(i));
  const rows = useMemo(() => {
    if (!after || p.kind === 'lessons') return [];
    const next = facts(t, after);
    if (p.kind === 'student') return next.filter(([, v]) => v).map(([k, v]) => ({ k, v, was: '' }));
    const prev = current ? facts(t, current) : [];
    return next.flatMap(([k, v], i) => (prev[i]?.[1] !== v ? [{ k, v, was: prev[i]?.[1] ?? '' }] : []));
  }, [after, current, p.kind, t]);

  const title = p.kind === 'student' ? fill(t('proposal.student'), { name: p.student.name }) : p.kind === 'profile' ? t('proposal.profile') : fill(t('proposal.lessons'), { n: lessons.length });
  const minutes = after?.delivery.minutesPerSession;

  const act = async (fn: () => Promise<AppliedProposal | null>) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (e) {
      setError(cleanError(e));
      setBusy(false);
    }
  };
  const confirm = () => act(() => window.tutordesk.proposals.apply(p.id, lessons.length ? { lessons: kept } : {}, threadId));
  const dismiss = () =>
    act(async () => {
      await window.tutordesk.proposals.dismiss(p.id, threadId);
      return null;
    });

  return (
    <div data-testid={`proposal-${p.kind}`} className="mt-3 rounded-lg border border-border-strong bg-surface">
      <div className="px-4 pt-3">
        <p className="text-[12px] text-text-3">{t('proposal.by')}</p>
        <p className="text-[14px] font-medium">{title}</p>
        {p.note && <p className="mt-0.5 text-[13px] text-text-2">{p.note}</p>}
      </div>

      {invalid ? (
        <p className="px-4 pt-2 text-[13px] text-danger">{fill(t('proposal.invalid'), { error: invalid })}</p>
      ) : (
        rows.length > 0 && (
          <dl className="grid grid-cols-[minmax(72px,auto)_1fr] gap-x-4 gap-y-1.5 px-4 pt-3 text-[13px]">
            {rows.map((r) => (
              <div key={r.k} className="contents">
                <dt className="text-text-3">{r.k}</dt>
                <dd className="min-w-0">
                  {r.was && <span className="text-text-3 line-through decoration-text-3/60">{r.was}</span>}
                  {r.was && <span className="px-1.5 text-text-3">→</span>}
                  <span>{r.v || t('common.notSet')}</span>
                </dd>
              </div>
            ))}
          </dl>
        )
      )}
      {p.kind === 'profile' && !invalid && rows.length === 0 && <p className="px-4 pt-2 text-[13px] text-text-3">{t('proposal.noChange')}</p>}

      {lessons.length > 0 && (
        <div className="px-4 pt-3">
          {p.kind === 'student' && <p className="mb-1 text-[12px] text-text-3">{t('proposal.firstLessons')}</p>}
          <ul className="flex flex-col">
            {lessons.map((l, i) => (
              <li key={`${l.date}-${i}`}>
                <label className={clsx('flex cursor-pointer items-baseline gap-2.5 py-1 text-[13px]', skip.has(i) && 'text-text-3 line-through')}>
                  <input
                    type="checkbox"
                    className="relative top-[2px] accent-[var(--accent)]"
                    checked={!skip.has(i)}
                    onChange={() =>
                      setSkip((s) => {
                        const n = new Set(s);
                        if (n.has(i)) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                  />
                  <span className="min-w-24 shrink-0 whitespace-nowrap tabular-nums">{dayLabel(l.date)}</span>
                  <span className="min-w-0 text-text-2">
                    {l.minutes ?? minutes ?? '—'} min{l.topic ? ` · ${l.topic}` : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 px-4 pt-3 pb-3">
        <Button data-testid="proposal-confirm" variant="primary" className="h-8" disabled={busy || !!invalid || (p.kind === 'lessons' && kept.length === 0)} onClick={() => void confirm()}>
          {t('proposal.confirm')}
        </Button>
        {p.kind !== 'lessons' && after && (
          <Button data-testid="proposal-edit" className="h-8" disabled={busy} onClick={() => setEditing(true)}>
            {t('proposal.edit')}
          </Button>
        )}
        <Button data-testid="proposal-dismiss" variant="ghost" className="h-8" disabled={busy} onClick={() => void dismiss()}>
          {t('proposal.dismiss')}
        </Button>
        {error && <p className="ml-1 min-w-0 truncate text-[13px] text-danger" title={error}>{error}</p>}
      </div>

      {editing && after && (
        <ProfileDialog
          profile={after}
          title={t('proposal.editTitle')}
          onClose={() => setEditing(false)}
          onSaved={() => {}}
          onSubmit={async (patch) => {
            const r = await window.tutordesk.proposals.apply(p.id, p.kind === 'student' ? { student: toStudent(patch, p.student), lessons: kept } : { changes: patch }, threadId);
            onDone(r);
          }}
        />
      )}
    </div>
  );
}
