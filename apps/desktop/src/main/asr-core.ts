import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Local speech-to-text (voice input): the model, its download, and the checks around them. No
 * Electron here, so it can be tested; asr.ts runs the recognizer in its own process.
 */

export interface ModelFile {
  name: string;
  size: number;
  sha256: string;
}

export interface ModelSource {
  name: string;
  url: (file: string) => string;
}

export interface SpeechModel {
  id: string;
  /**
   * Where the files can be fetched, tried in order. A mirror does not need to be trusted: every file
   * must match its pinned size and SHA-256 before it is used.
   */
  sources: ModelSource[];
  files: ModelFile[];
}

/** Which speech the tutor dictates: English, or Chinese (and Chinese mixed with English). */
export type VoiceLanguage = 'english' | 'chinese';

/** A model sherpa-onnx can run, and its recognizer settings for files in `dir`. */
export interface SpeechEngine extends SpeechModel {
  language: VoiceLanguage;
  modelConfig: (dir: string) => Record<string, unknown>;
}

/**
 * SenseVoice Small (int8): Chinese, Cantonese, Japanese, Korean, and Chinese mixed with English.
 * Weak on English alone (15% word errors on Australian speakers, against 0.5% for Parakeet).
 */
export const SENSE_VOICE: SpeechEngine = {
  id: 'sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
  language: 'chinese',
  modelConfig: (dir) => ({ senseVoice: { model: path.join(dir, 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 }, tokens: path.join(dir, 'tokens.txt') }),
  sources: [
    // The upstream release by the sherpa-onnx authors, pinned to one commit.
    { name: 'huggingface', url: (f) => `https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/resolve/355f4d4884d8afd08aef04b9007a8556d7b463b2/${f}` },
    // A copy on ModelScope, reachable from mainland China.
    { name: 'modelscope', url: (f) => `https://www.modelscope.cn/api/v1/models/Mr7Cat/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/repo?Revision=master&FilePath=${encodeURIComponent(f)}` },
  ],
  files: [
    { name: 'model.int8.onnx', size: 237_115_547, sha256: '12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d' },
    { name: 'tokens.txt', size: 315_894, sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc' },
  ],
};

/**
 * NVIDIA Parakeet TDT 0.6B v2 (int8, CC-BY-4.0): English only, with punctuation and capitals.
 * 0.5% word errors on twelve Australian speakers; a two-minute recording in about 11 s on 4 threads.
 */
export const PARAKEET: SpeechEngine = {
  id: 'parakeet-tdt-0.6b-v2-int8',
  language: 'english',
  sources: [
    { name: 'huggingface', url: (f) => `https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/resolve/1ab9323565ddb038682214b292f588070a538ce2/${f}` },
    { name: 'modelscope', url: (f) => `https://www.modelscope.cn/api/v1/models/liaowenbin/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/repo?Revision=master&FilePath=${encodeURIComponent(f)}` },
  ],
  files: [
    { name: 'encoder.int8.onnx', size: 652_184_296, sha256: 'a32b12d17bbbc309d0686fbbcc2987b5e9b8333a7da83fa6b089f0a2acd651ab' },
    { name: 'decoder.int8.onnx', size: 7_257_753, sha256: 'b6bb64963457237b900e496ee9994b59294526439fbcc1fecf705b31a15c6b4e' },
    { name: 'joiner.int8.onnx', size: 1_739_080, sha256: '7946164367946e7f9f29a122407c3252b680dbae9a51343eb2488d057c3c43d2' },
    { name: 'tokens.txt', size: 9_384, sha256: 'ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d' },
  ],
  modelConfig: (dir) => ({
    transducer: { encoder: path.join(dir, 'encoder.int8.onnx'), decoder: path.join(dir, 'decoder.int8.onnx'), joiner: path.join(dir, 'joiner.int8.onnx') },
    tokens: path.join(dir, 'tokens.txt'),
    modelType: 'nemo_transducer',
  }),
};

export const SPEECH_ENGINES: Record<VoiceLanguage, SpeechEngine> = { english: PARAKEET, chinese: SENSE_VOICE };

/** The tutor's choice, or by interface language; anything unknown falls back to that default. */
export function engineFor(choice: unknown, uiLanguage: string): SpeechEngine {
  if (choice === 'english' || choice === 'chinese') return SPEECH_ENGINES[choice];
  return uiLanguage === 'zh' ? SENSE_VOICE : PARAKEET;
}

/** Everything the recognizer process needs; built here so the worker never composes paths itself. */
export function recognizerConfig(e: SpeechEngine, dir: string, threads: number): Record<string, unknown> {
  return { featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 }, modelConfig: { ...e.modelConfig(dir), numThreads: threads, provider: 'cpu', debug: 0 } };
}

export const SAMPLE_RATE = 16_000;
/** Longest recording accepted: two minutes. */
export const MAX_SECONDS = 120;

export const modelBytes = (m: SpeechModel) => m.files.reduce((a, f) => a + f.size, 0);

/** Installed means every file is there with its exact size (hashes were checked when downloaded). */
export async function isInstalled(m: SpeechModel, dir: string): Promise<boolean> {
  for (const f of m.files) {
    const s = await stat(path.join(dir, f.name)).catch(() => null);
    if (!s?.isFile() || s.size !== f.size) return false;
  }
  return true;
}

export class DownloadError extends Error {}

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  fetch?: typeof fetch;
  /** Give up on a source that sends nothing for this long (default 20 s), and try the next. */
  stallMs?: number;
}

/**
 * Download every file of the model into `dir`, trying each source in turn. Each file streams into a
 * .part file while its SHA-256 is computed; it is renamed into place only when size and hash match
 * the pinned values. A server sending more bytes than expected is cut off. Anything wrong leaves no
 * file behind.
 */
export async function downloadModel(m: SpeechModel, dir: string, opts: DownloadOptions = {}): Promise<void> {
  const total = modelBytes(m);
  let before = 0;
  await mkdir(dir, { recursive: true });
  for (const f of m.files) {
    const final = path.join(dir, f.name);
    const existing = await stat(final).catch(() => null);
    if (!(existing?.isFile() && existing.size === f.size)) {
      const failures: string[] = [];
      for (const source of m.sources) {
        try {
          await fetchFile(source.url(f.name), f, `${final}.part`, opts, (got) => opts.onProgress?.(before + got, total));
          await rename(`${final}.part`, final);
          failures.length = 0;
          break;
        } catch (e) {
          await rm(`${final}.part`, { force: true });
          if (opts.signal?.aborted) throw new DownloadError('Download cancelled.');
          failures.push(`${source.name}: ${(e as Error).message}`);
        }
      }
      if (failures.length) throw new DownloadError(`Could not download the speech model (${failures.join('; ')}).`);
    }
    before += f.size;
    opts.onProgress?.(before, total);
  }
}

async function fetchFile(url: string, f: ModelFile, part: string, opts: DownloadOptions, progress: (got: number) => void): Promise<void> {
  const stall = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stall.abort(), opts.stallMs ?? 20_000);
  };
  const signal = opts.signal ? AbortSignal.any([opts.signal, stall.signal]) : stall.signal;
  alive();
  try {
    const res = await (opts.fetch ?? fetch)(url, { signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new DownloadError(`server answered ${res.status}`);
    const hash = createHash('sha256');
    const out = createWriteStream(part);
    let got = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        alive();
        got += chunk.byteLength;
        if (got > f.size) throw new DownloadError(`${f.name} is larger than expected`);
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        progress(got);
      }
    } finally {
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    }
    if (got !== f.size) throw new DownloadError(`${f.name} is incomplete (${got} of ${f.size} bytes)`);
    if (hash.digest('hex') !== f.sha256) throw new DownloadError(`${f.name} does not match its checksum`);
  } catch (e) {
    if (stall.signal.aborted && !opts.signal?.aborted) throw new DownloadError('no data for too long');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Sources in the order to try: from mainland China, the mirror there first. */
export function sourcesFor<M extends SpeechModel>(m: M, preferChina: boolean): M {
  return preferChina ? { ...m, sources: [...m.sources].sort((a, b) => Number(b.name === 'modelscope') - Number(a.name === 'modelscope')) } : m;
}

/** Audio from the renderer: mono 16 kHz samples, at most MAX_SECONDS, nothing that is not a finite number. */
export function checkSamples(x: unknown): Float32Array {
  if (!(x instanceof Float32Array)) throw new Error('Audio must be 16 kHz mono samples.');
  if (x.length < SAMPLE_RATE / 4) throw new Error('The recording is too short.');
  if (x.length > SAMPLE_RATE * MAX_SECONDS) throw new Error(`Recordings can be at most ${MAX_SECONDS / 60} minutes.`);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    out[i] = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
  }
  return out;
}

const KEEP_CAPS = new Set(['IELTS', 'PTE', 'TOEFL', 'AI', 'OK', 'PDF', 'UK', 'US', 'TV']);

/**
 * SenseVoice writes English in capitals and may leave emotion or event tags. Lower-case English words
 * when the model shouted all of them (keeping exam names), capitalise sentence starts and "I".
 */
export function tidyTranscript(raw: string): string {
  let s = raw.replace(/<\|[^|]*\|>/g, '').trim();
  if (/[A-Z]{2,}/.test(s) && !/[a-z]/.test(s)) {
    s = s.replace(/[A-Z][A-Z']*/g, (w) => (KEEP_CAPS.has(w) ? w : w.toLowerCase()));
    s = s.replace(/(^|[.!?。！？]\s*)([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
    s = s.replace(/\bi\b/g, 'I').replace(/\bi'/g, "I'");
  }
  return s;
}
