import { Button } from '@tutordesk/ui';
import { X } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import type { Proposal, StudentProfile } from '@tutordesk/core/schemas';
import { useT } from '../i18n';
import { AgentControls } from '../thread/AgentControls';
import { ThreadPanel, type Recipe } from '../thread/ThreadPanel';
import { useThread } from '../thread/useThread';
import { ProposalCard, useProposals } from './Proposals';

/**
 * The student page's conversation: the tutor tells the agent what changed or asks it to schedule
 * lessons; what it proposes shows as cards in the conversation, applied only on Confirm.
 */
export function StudentAssistant({ profile, proposals, onChanged, onClose }: { profile: StudentProfile; proposals: Proposal[]; onChanged: () => void; onClose: () => void }) {
  const t = useT();
  const subject = useMemo(() => ({ type: 'student' as const, studentId: profile.id }), [profile.id]);
  const thread = useThread(subject, onChanged);
  const agent = thread.view?.agent ?? 'api';
  const recipes: Recipe[] = [
    { id: 'schedule', label: t('recipe.schedule'), text: t('recipe.scheduleText'), prefill: true },
    { id: 'profile', label: t('recipe.updateProfile'), text: t('recipe.updateProfileText'), prefill: true },
  ];
  return (
    <aside data-testid="assistant" className="flex w-[440px] shrink-0 flex-col border-l border-border bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {thread.view && <AgentControls agent={agent} mode={thread.view.mode} disabled={thread.running} onChange={(p) => void thread.configure(p)} />}
        <Button variant="ghost" className="ml-auto h-7 px-2" aria-label={t('common.close')} onClick={onClose}>
          <X size={16} strokeWidth={1.5} />
        </Button>
      </header>
      <ThreadPanel
        narrow
        thread={thread}
        agent={agent}
        recipes={recipes}
        onAttach={() => window.tutordesk.threads.attach(profile.id)}
        empty={t('assistant.studentEmpty')}
        extra={proposals.map((p) => (
          <ProposalCard key={p.id} p={p} current={profile} threadId={thread.view?.id} onDone={onChanged} />
        ))}
      />
    </aside>
  );
}

/** Adding a student by describing them: the agent turns the description into a profile card. */
export function IntakeAssistant({ heading, onCreated }: { heading: ReactNode; onCreated: (studentId: string) => void }) {
  const t = useT();
  const subject = useMemo(() => ({ type: 'workspace' as const }), []);
  const { list, reload } = useProposals({ kind: 'student' });
  const thread = useThread(subject, reload);
  const agent = thread.view?.agent ?? 'api';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-8">
        {heading}
        <div className="ml-auto">{thread.view && <AgentControls agent={agent} mode={thread.view.mode} disabled={thread.running} onChange={(p) => void thread.configure(p)} />}</div>
      </header>
      <ThreadPanel
        thread={thread}
        agent={agent}
        recipes={[]}
        placeholder={t('assistant.intakePlaceholder')}
        empty={t('assistant.intakeEmpty')}
        extra={list.map((p) => (
          <ProposalCard
            key={p.id}
            p={p}
            threadId={thread.view?.id}
            onDone={(r) => {
              reload();
              if (r) onCreated(r.studentId);
            }}
          />
        ))}
      />
    </div>
  );
}
