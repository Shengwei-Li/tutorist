import { Button, Dialog } from '@tutordesk/ui';
import { Mic, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechStatus } from '../../../shared/ipc';
import { useT } from '../i18n';
import { cleanError } from '../useRun';
import { fill } from './labels';

const RATE = 16_000;
const MAX_SECONDS = 120;

/** The speech model's state, kept current while it downloads. */
export function useSpeechModel() {
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => void window.tutordesk.speech.status().then(setStatus), []);
  useEffect(() => {
    refresh();
    return window.tutordesk.speech.onProgress(setStatus);
  }, [refresh]);
  const install = async () => {
    setError(null);
    setStatus((s) => (s ? { ...s, state: 'downloading', done: 0 } : s));
    try {
      await window.tutordesk.speech.install();
    } catch (e) {
      setError(cleanError(e));
    }
    refresh();
  };
  const uninstall = async () => {
    await window.tutordesk.speech.uninstall();
    refresh();
  };
  const cancel = () => void window.tutordesk.speech.cancelInstall();
  return { status, error, install, uninstall, cancel };
}

export const mb = (n: number) => `${Math.round(n / 1e6)} MB`;

/** Resample to 16 kHz mono with the browser's own resampler. */
async function to16k(chunks: Float32Array[], rate: number): Promise<Float32Array> {
  // The recognizer takes at most MAX_SECONDS; the auto-stop can overshoot by a fraction of a second.
  const length = Math.min(chunks.reduce((a, c) => a + c.length, 0), rate * MAX_SECONDS);
  const all = new Float32Array(length);
  let at = 0;
  for (const c of chunks) {
    if (at >= length) break;
    all.set(c.subarray(0, length - at), at);
    at += Math.min(c.length, length - at);
  }
  if (rate === RATE || length === 0) return all;
  const offline = new OfflineAudioContext(1, Math.ceil((length * RATE) / rate), RATE);
  const buf = offline.createBuffer(1, length, rate);
  buf.copyToChannel(all, 0);
  const src = offline.createBufferSource();
  src.buffer = buf;
  src.connect(offline.destination);
  src.start();
  return (await offline.startRendering()).getChannelData(0).slice(0, RATE * MAX_SECONDS);
}

type Phase = 'idle' | 'recording' | 'transcribing';

/**
 * Microphone recording for voice input. Audio stays in memory until it is transcribed on this
 * computer; nothing is saved. Recording stops by itself after two minutes.
 */
function useRecorder(onText: (text: string) => void) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<{ stream: MediaStream; ctx: AudioContext; chunks: Float32Array[]; timer: number } | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;

  const release = () => {
    const l = live.current;
    live.current = null;
    if (!l) return null;
    clearInterval(l.timer);
    l.stream.getTracks().forEach((tr) => tr.stop());
    void l.ctx.close();
    return l;
  };

  const stop = useCallback(async () => {
    const l = release();
    if (!l) return;
    setPhase('transcribing');
    try {
      const samples = await to16k(l.chunks, l.ctx.sampleRate);
      // Under a quarter of a second is a mis-click, not speech.
      if (samples.length >= RATE / 4) {
        const text = (await window.tutordesk.speech.transcribe(samples)).trim();
        if (text) textRef.current(text);
      }
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setPhase('idle');
    }
  }, []);

  const start = async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch {
      setError('mic');
      return;
    }
    const ctx = new AudioContext();
    try {
      await ctx.audioWorklet.addModule(new URL('recorder-worklet.js', document.baseURI).href);
      const node = new AudioWorkletNode(ctx, 'tutordesk-recorder');
      const chunks: Float32Array[] = [];
      node.port.onmessage = (e: MessageEvent<Float32Array>) => chunks.push(e.data);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      ctx.createMediaStreamSource(stream).connect(node).connect(mute).connect(ctx.destination);
      const began = Date.now();
      setSeconds(0);
      const timer = window.setInterval(() => {
        const s = Math.floor((Date.now() - began) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) void stop();
      }, 250);
      live.current = { stream, ctx, chunks, timer };
      setPhase('recording');
    } catch (e) {
      stream.getTracks().forEach((tr) => tr.stop());
      void ctx.close();
      setError(cleanError(e));
    }
  };

  // Leaving the page stops the microphone.
  useEffect(() => () => void release(), []);

  return { phase, seconds, error, start, stop };
}

/** Download the model once, after saying what it is and where the audio goes. */
export function VoiceSetup({ onReady, onClose }: { onReady: () => void; onClose: () => void }) {
  const t = useT();
  const m = useSpeechModel();
  const s = m.status;
  useEffect(() => {
    if (s?.state === 'ready') onReady();
  }, [s?.state, onReady]);
  const downloading = s?.state === 'downloading';
  return (
    <Dialog
      title={t('voice.setupTitle')}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={() => (downloading ? m.cancel() : onClose())}>
            {t('common.cancel')}
          </Button>
          <Button data-testid="voice-install" variant="primary" disabled={!s || downloading} onClick={() => void m.install()}>
            {fill(t('voice.download'), { size: s ? mb(s.total) : '' })}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-2">{t('voice.setupBody')}</p>
      {downloading && s && <Progress done={s.done} total={s.total} />}
      {m.error && <p className="mt-2 text-sm text-danger">{m.error}</p>}
    </Dialog>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-28 text-right text-xs text-text-3 tabular-nums">
        {mb(done)} / {mb(total)}
      </span>
    </div>
  );
}

/** The composer's microphone: click to talk, click again to stop; the text lands in the composer. */
export function VoiceButton({ disabled, onText }: { disabled?: boolean; onText: (text: string) => void }) {
  const t = useT();
  const rec = useRecorder(onText);
  const [setup, setSetup] = useState(false);

  const begin = async () => {
    const s = await window.tutordesk.speech.status();
    if (s.state !== 'ready') setSetup(true);
    else await rec.start();
  };

  const err = rec.error === 'mic' ? t('voice.noMic') : rec.error;
  return (
    <>
      {rec.phase === 'recording' ? (
        <button data-testid="voice-stop" onClick={() => void rec.stop()} className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-text hover:bg-surface-2" aria-label={t('voice.stop')}>
          <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
          <span className="tabular-nums">
            {Math.floor(rec.seconds / 60)}:{String(rec.seconds % 60).padStart(2, '0')}
          </span>
          <Square size={12} strokeWidth={2} />
        </button>
      ) : rec.phase === 'transcribing' ? (
        <span className="flex h-8 items-center gap-2 px-2 text-[13px] text-text-3">
          <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-border-strong border-t-text-2" />
          {t('voice.transcribing')}
        </span>
      ) : (
        <button
          data-testid="voice-start"
          aria-label={t('voice.start')}
          title={t('voice.start')}
          disabled={disabled}
          onClick={() => void begin()}
          className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface-2 hover:text-text disabled:opacity-45"
        >
          <Mic size={16} strokeWidth={1.5} />
        </button>
      )}
      {err && rec.phase === 'idle' && (
        <span className="min-w-0 truncate text-[12px] text-danger" title={err}>
          {err}
        </span>
      )}
      {setup && (
        <VoiceSetup
          onClose={() => setSetup(false)}
          onReady={() => setSetup(false)}
        />
      )}
    </>
  );
}
