import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import type { SpeechStatus } from '../shared/ipc.js';
import { SAMPLE_RATE, checkSamples, downloadModel, engineFor, isInstalled, modelBytes, recognizerConfig, sourcesFor, tidyTranscript, type SpeechEngine } from './asr-core.js';
import { cloudSpeechModel, transcribeInCloud } from './asr-cloud.js';
import { loadApiKey, loadSettings } from './settings.js';

/** Unload the model after this long without a recording. */
const IDLE_MS = 3 * 60_000;
const LOAD_TIMEOUT_MS = 60_000;

type Reply = { type: 'loaded' } | { type: 'result'; id: number; text: string } | { type: 'error'; id?: number; message: string };

/**
 * Voice input. On this computer (the default): the model is downloaded only when the tutor asks for it,
 * loaded in a separate process on the first recording, and unloaded again when voice input goes unused.
 * In the cloud, when the tutor chooses it: each recording goes to their AI service with their key.
 */
export class SpeechService {
  private worker: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  private idle: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private download: { abort: AbortController; done: number; finished: Promise<void>; engine: SpeechEngine } | null = null;
  /** The model the running process holds. */
  private loaded: SpeechEngine | null = null;

  private dir(e: SpeechEngine): string {
    return path.join(app.getPath('userData'), 'models', e.id);
  }

  /** The model for the tutor's chosen language: English (Parakeet) or Chinese (SenseVoice). */
  private async engine(): Promise<SpeechEngine> {
    const s = await loadSettings();
    return engineFor(s.voiceLanguage, s.language);
  }

  /** Cloud voice input can work: the AI service in Settings takes audio and has a key. */
  private async cloudReady(): Promise<boolean> {
    if (process.env.TUTORDESK_FAKE_AI === '1') return true;
    const { api } = await loadSettings();
    return !!cloudSpeechModel(api.gateway) && !!(await loadApiKey(api.gateway));
  }

  private async base(): Promise<Pick<SpeechStatus, 'engine' | 'cloud' | 'language' | 'total'>> {
    const [s, e, cloud] = await Promise.all([loadSettings(), this.engine(), this.cloudReady()]);
    return { engine: s.voiceEngine ?? 'local', cloud, language: e.language, total: modelBytes(e) };
  }

  async status(): Promise<SpeechStatus> {
    const b = await this.base();
    if (b.engine === 'cloud') return { ...b, state: b.cloud ? 'ready' : 'absent', done: 0 };
    const e = await this.engine();
    if (this.download?.engine === e) return { ...b, state: 'downloading', done: this.download.done };
    return { ...b, state: (await isInstalled(e, this.dir(e))) ? 'ready' : 'absent', done: 0 };
  }

  /** Download and verify the model; progress goes to the window that asked. */
  async install(sender: WebContents): Promise<void> {
    if (this.download) throw new Error('A speech model is already downloading.');
    const e = await this.engine();
    const b = await this.base();
    const abort = new AbortController();
    const china = (await loadSettings()).language === 'zh';
    let last = 0;
    const finished = downloadModel(sourcesFor(e, china), this.dir(e), {
      signal: abort.signal,
      onProgress: (done, total) => {
        if (this.download) this.download.done = done;
        if (done - last < total / 200 && done !== total) return;
        last = done;
        if (!sender.isDestroyed()) sender.send('speech:progress', { ...b, state: 'downloading', done, total } satisfies SpeechStatus);
      },
    });
    this.download = { abort, done: 0, finished: finished.catch(() => {}), engine: e };
    try {
      await finished;
    } finally {
      this.download = null;
    }
  }

  cancelInstall(): void {
    this.download?.abort.abort();
  }

  async uninstall(): Promise<void> {
    // Let a cancelled download close its file before the folder goes.
    const e = await this.engine();
    const d = this.download;
    d?.abort.abort();
    await d?.finished;
    this.stop();
    await rm(this.dir(e), { recursive: true, force: true });
  }

  /** Transcribe one recording (16 kHz mono). One at a time; the text comes back for the tutor to check. */
  transcribe(samples: unknown): Promise<string> {
    const audio = checkSamples(samples);
    const run = this.queue.then(() => this.run(audio));
    this.queue = run.catch(() => {});
    return run;
  }

  private async run(audio: Float32Array): Promise<string> {
    const s = await loadSettings();
    if (s.voiceEngine === 'cloud') {
      if (process.env.TUTORDESK_FAKE_AI === '1') return 'Dictated in the cloud.';
      // Switched from this computer: the local model need not stay in memory.
      this.stop();
      return tidyTranscript(await transcribeInCloud(audio, { gateway: s.api.gateway, apiKey: await loadApiKey(s.api.gateway) }));
    }
    const e = await this.engine();
    if (!(await isInstalled(e, this.dir(e)))) throw new Error('Download the speech model first (Settings → Voice input).');
    if (this.idle) clearTimeout(this.idle);
    // The tutor switched language since the last recording: load the other model.
    if (this.loaded && this.loaded !== e) this.stop();
    try {
      await this.start(e);
      const id = this.nextId++;
      // Generous: both models run at about a tenth of real time or faster on a laptop CPU.
      const limit = 30_000 + (audio.length / SAMPLE_RATE) * 1000;
      const text = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiting.delete(id);
          reject(new Error('Speech recognition took too long.'));
          this.stop();
        }, limit);
        this.waiting.set(id, { resolve, reject, timer });
        this.worker!.postMessage({ type: 'transcribe', id, samples: audio });
      });
      return tidyTranscript(text);
    } finally {
      this.idle = setTimeout(() => this.stop(), IDLE_MS);
    }
  }

  private start(e: SpeechEngine): Promise<void> {
    if (this.ready) return this.ready;
    this.loaded = e;
    // The recognizer needs no secrets: it starts without API keys or tokens in its environment.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|PASSWORD|AUTH/i.test(k)));
    const worker = utilityProcess.fork(path.join(import.meta.dirname, 'asr-worker.js'), [], { serviceName: 'TutorDesk speech', stdio: 'ignore', env });
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The speech model did not load.')), LOAD_TIMEOUT_MS);
      worker.on('message', (m: Reply) => {
        if (m.type === 'loaded') {
          clearTimeout(timer);
          resolve();
        } else if (m.type === 'error' && m.id === undefined) {
          clearTimeout(timer);
          reject(new Error(`Could not load the speech model: ${m.message}`));
        } else if (m.id !== undefined) {
          const w = this.waiting.get(m.id);
          if (!w) return;
          this.waiting.delete(m.id);
          clearTimeout(w.timer);
          if (m.type === 'result') w.resolve(m.text);
          else w.reject(new Error(m.message));
        }
      });
      worker.on('exit', () => {
        clearTimeout(timer);
        reject(new Error('The speech process stopped.'));
        if (this.worker === worker) this.reset(new Error('The speech process stopped.'));
      });
    });
    this.ready.catch(() => this.stop());
    // Up to four threads: faster than two (11 s instead of 15 s for two minutes), without taking the machine.
    const threads = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)));
    worker.postMessage({ type: 'load', config: recognizerConfig(e, this.dir(e), threads) });
    return this.ready;
  }

  private reset(err: Error): void {
    for (const w of this.waiting.values()) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    this.waiting.clear();
    this.worker = null;
    this.ready = null;
    this.loaded = null;
  }

  /** Unload the model: the process and its memory go away. */
  stop(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    const w = this.worker;
    this.reset(new Error('Speech recognition was stopped.'));
    w?.kill();
  }
}
