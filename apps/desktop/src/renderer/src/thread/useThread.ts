import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentId, AgentMode, ThreadEntry, ThreadEvent, ThreadSubject, ThreadView } from '../../../shared/ipc';
import { cleanError } from '../useRun';

/** What the log shows: persisted entries plus the live turn, in one shape. */
export type Block =
  | { kind: 'tutor'; text: string; at: string }
  | { kind: 'agent'; text: string; at: string; by?: AgentId; streaming?: boolean }
  | { kind: 'tool'; id: string; name: string; status: 'running' | 'ok' | 'error'; summary?: string; target?: string; at: string }
  | { kind: 'system'; text: string; at: string; tone?: 'warning' };

export type Approval = Extract<ThreadEvent, { type: 'approval' }>;

function fromEntry(e: ThreadEntry, i: number): Block {
  switch (e.role) {
    case 'tutor':
      return { kind: 'tutor', text: e.text, at: e.at };
    case 'agent':
      return { kind: 'agent', text: e.text, at: e.at, by: e.by };
    case 'tool':
      return { kind: 'tool', id: `h${i}`, name: e.name, status: e.ok ? 'ok' : 'error', summary: e.summary, target: e.target, at: e.at };
    case 'system':
      return { kind: 'system', text: e.text, at: e.at };
  }
}

const SAVES = /^(save_|export_|create_lesson|append_note|propose_)/;

function targetOf(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const i = input as Record<string, unknown>;
  const v = i.kind ?? i.topic ?? i.path ?? i.file_path ?? i.pattern ?? i.query ?? i.name ?? i.command;
  return typeof v === 'string' ? v : undefined;
}

/**
 * One conversation about a teaching object (appendix E.9). `onSaved` fires whenever the agent saved
 * something through TutorDesk, so the page can refresh the document it shows.
 */
export function useThread(subject: ThreadSubject, onSaved?: () => void) {
  const [view, setView] = useState<ThreadView | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [pending, setPending] = useState<Approval[]>([]);
  const [usd, setUsd] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const key = JSON.stringify(subject);

  useEffect(() => {
    let live = true;
    // A new subject starts clean: nothing from the previous thread may be shown or sent to.
    setView(null);
    setBlocks([]);
    setRunning(false);
    setStartedAt(null);
    setPending([]);
    setUsd(0);
    setError(null);
    void window.tutordesk.threads.open(JSON.parse(key) as ThreadSubject).then((v) => {
      if (!live) return;
      setView(v);
      setBlocks(v.entries.map(fromEntry));
      setRunning(v.running);
      setPending(v.pending);
    });
    return () => {
      live = false;
    };
  }, [key]);

  const id = view?.id;
  useEffect(() => {
    if (!id) return;
    return window.tutordesk.threads.onEvent((threadId, ev) => {
      if (threadId !== id) return;
      const at = new Date().toISOString();
      switch (ev.type) {
        case 'text':
          setBlocks((bs) => {
            const last = bs.at(-1);
            if (last?.kind === 'agent' && last.streaming) return [...bs.slice(0, -1), { ...last, text: last.text + ev.delta }];
            return [...bs, { kind: 'agent', text: ev.delta, at, streaming: true }];
          });
          break;
        case 'tool':
          setBlocks((bs) => {
            const settled = bs.map((b) => (b.kind === 'agent' && b.streaming ? { ...b, streaming: false } : b));
            const i = settled.findIndex((b) => b.kind === 'tool' && b.id === ev.id);
            if (i < 0) return [...settled, { kind: 'tool', id: ev.id, name: ev.name, status: ev.status, summary: ev.summary, target: targetOf(ev.input), at }];
            const prev = settled[i] as Extract<Block, { kind: 'tool' }>;
            return settled.map((b, j) => (j === i ? { ...prev, status: ev.status, summary: ev.summary ?? prev.summary } : b));
          });
          if (ev.status === 'ok' && SAVES.test(ev.name)) saved.current?.();
          break;
        case 'approval':
          setPending((p) => [...p, ev]);
          break;
        case 'notice':
          setBlocks((bs) => [...bs, { kind: 'system', text: ev.message, at, tone: ev.level === 'warning' ? 'warning' : undefined }]);
          break;
        case 'usage':
          if (ev.usd) setUsd((u) => u + ev.usd!);
          break;
        case 'turn_end':
          setRunning(false);
          setStartedAt(null);
          setPending([]);
          setBlocks((bs) => {
            const next = bs.map((b) => (b.kind === 'agent' && b.streaming ? { ...b, streaming: false } : b));
            if (ev.status === 'failed') next.push({ kind: 'system', text: ev.error ?? 'The agent stopped with an error.', at, tone: 'warning' });
            if (ev.status === 'interrupted') next.push({ kind: 'system', text: 'Stopped.', at });
            return next;
          });
          saved.current?.();
          break;
        default:
          break;
      }
    });
  }, [id]);

  const send = useCallback(
    async (text: string) => {
      if (!id || !text.trim()) return;
      setError(null);
      setRunning(true);
      setStartedAt(Date.now());
      setBlocks((bs) => [...bs, { kind: 'tutor', text: text.trim(), at: new Date().toISOString() }]);
      try {
        await window.tutordesk.threads.send(id, text.trim());
      } catch (e) {
        setRunning(false);
        setStartedAt(null);
        setError(cleanError(e));
      }
    },
    [id],
  );

  const respond = useCallback(
    (requestId: string, decision: 'allow' | 'deny') => {
      if (!id) return;
      setPending((p) => p.filter((a) => a.requestId !== requestId));
      void window.tutordesk.threads.respond(id, requestId, decision);
    },
    [id],
  );

  const configure = useCallback(
    async (patch: { agent?: AgentId; mode?: AgentMode }) => {
      if (!id) return;
      setError(null);
      try {
        const v = await window.tutordesk.threads.configure(id, patch);
        setView(v);
        setBlocks(v.entries.map(fromEntry));
      } catch (e) {
        setError(cleanError(e));
      }
    },
    [id],
  );

  return {
    view,
    blocks,
    running,
    startedAt,
    pending,
    usd,
    error,
    send,
    respond,
    configure,
    interrupt: () => id && void window.tutordesk.threads.interrupt(id),
  };
}

export type ThreadState = ReturnType<typeof useThread>;
