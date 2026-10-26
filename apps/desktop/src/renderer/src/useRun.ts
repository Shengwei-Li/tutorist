import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunEvent } from '../../shared/ipc';

export interface RunLine {
  text: string;
  tone: 'muted' | 'normal' | 'error';
}

function describe(ev: RunEvent): RunLine | null {
  if (ev.type === 'step') {
    const what = [ev.step, ev.kind].filter(Boolean).join(' · ');
    const round = ev.round ? ` (round ${ev.round})` : '';
    if (ev.status === 'start') return { text: `${what}${round}…`, tone: 'normal' };
    if (ev.status === 'fail') return { text: `${what}: needs your review${ev.message ? ` — ${ev.message}` : ''}`, tone: 'error' };
    return { text: `${what} ✓`, tone: 'muted' };
  }
  if (ev.type === 'agent') {
    const e = ev.event;
    if (e.type === 'usage') return { text: `  tokens ${e.inputTokens} in / ${e.outputTokens} out${e.usd !== undefined ? ` · $${e.usd.toFixed(3)}` : ''}`, tone: 'muted' };
    if (e.type === 'error') return { text: `  ${e.message}`, tone: 'error' };
    if (e.type === 'tool_call') return { text: `  ${e.name}`, tone: 'muted' };
    return null;
  }
  return ev.ok ? null : { text: ev.error ?? 'Failed', tone: 'error' };
}

/** Track one long-running AI job: progress lines, cost, result, cancel. */
export function useRun(onFinished?: (ok: boolean, result: unknown) => void) {
  const [runId, setRunId] = useState<string | null>(null);
  const [lines, setLines] = useState<RunLine[]>([]);
  const [usd, setUsd] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<string | null>(null);
  const done = useRef(onFinished);
  done.current = onFinished;

  useEffect(
    () =>
      window.tutordesk.runs.onEvent((id, ev) => {
        if (id !== ref.current) return;
        if (ev.type === 'agent' && ev.event.type === 'usage') setUsd((u) => u + (ev.event.type === 'usage' ? (ev.event.usd ?? 0) : 0));
        const line = describe(ev);
        if (line) setLines((l) => [...l, line].slice(-200));
        if (ev.type === 'finished') {
          ref.current = null;
          setRunId(null);
          if (!ev.ok) setError(ev.error ?? 'Failed');
          done.current?.(ev.ok, ev.result);
        }
      }),
    [],
  );

  const start = useCallback(async (begin: () => Promise<string>) => {
    setLines([]);
    setUsd(0);
    setError(null);
    try {
      const id = await begin();
      ref.current = id;
      setRunId(id);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  }, []);

  const cancel = useCallback(() => {
    if (ref.current) void window.tutordesk.runs.cancel(ref.current);
  }, []);

  return { running: runId !== null, lines, usd, error, start, cancel };
}

export function cleanError(e: unknown): string {
  return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
