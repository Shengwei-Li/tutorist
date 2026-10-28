import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SENSE_VOICE, checkSamples, downloadModel, isInstalled, sourcesFor, tidyTranscript, type SpeechModel } from '../src/main/asr-core.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-asr-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const A = Buffer.from('a'.repeat(5000));
const B = Buffer.from('tokens\n');
const model = (over: Partial<Record<'a' | 'b', { size?: number; sha256?: string }>> = {}): SpeechModel => ({
  id: 'test',
  sources: [
    { name: 'main', url: (f) => `https://models.example/rev/${f}` },
    { name: 'mirror', url: (f) => `https://mirror.example/rev/${f}` },
  ],
  files: [
    { name: 'model.onnx', size: over.a?.size ?? A.length, sha256: over.a?.sha256 ?? sha(A) },
    { name: 'tokens.txt', size: over.b?.size ?? B.length, sha256: over.b?.sha256 ?? sha(B) },
  ],
});

/** A server that answers with these bodies, in chunks, and records what was asked. */
function server(bodies: Record<string, Buffer | number>) {
  const asked: string[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    asked.push(String(url));
    const body = bodies[String(url)] ?? bodies[String(url).split('/').pop()!];
    if (typeof body === 'number' || !body) return new Response('nope', { status: typeof body === 'number' ? body : 404 });
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        for (let i = 0; i < body.length; i += 1000) {
          if (init?.signal?.aborted) return c.error(new DOMException('aborted', 'AbortError'));
          c.enqueue(new Uint8Array(body.subarray(i, i + 1000)));
          await new Promise((r) => setTimeout(r, 1));
        }
        c.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
  return { fetch: f, asked };
}

describe('speech model download', () => {
  it('saves files only after size and checksum match, and reports progress to the end', async () => {
    const s = server({ 'model.onnx': A, 'tokens.txt': B });
    const progress: number[] = [];
    await downloadModel(model(), tmp, { fetch: s.fetch, onProgress: (d) => progress.push(d) });
    expect(await readFile(path.join(tmp, 'model.onnx'))).toEqual(A);
    expect(progress.at(-1)).toBe(A.length + B.length);
    expect(await isInstalled(model(), tmp)).toBe(true);
    expect(s.asked).toEqual(['https://models.example/rev/model.onnx', 'https://models.example/rev/tokens.txt']);

    // Installed files are not fetched again.
    const again = server({});
    await downloadModel(model(), tmp, { fetch: again.fetch });
    expect(again.asked).toEqual([]);
  });

  it('rejects a file whose checksum does not match and leaves nothing behind', async () => {
    const s = server({ 'model.onnx': Buffer.from('b'.repeat(5000)), 'tokens.txt': B });
    await expect(downloadModel(model(), tmp, { fetch: s.fetch })).rejects.toThrow(/main: model.onnx does not match its checksum; mirror: model.onnx does not match/);
    expect(await readdir(tmp)).toEqual([]);
    expect(await isInstalled(model(), tmp)).toBe(false);
  });

  it('cuts off a server that sends more than expected, or less', async () => {
    await expect(downloadModel(model({ a: { size: 3000 } }), tmp, { fetch: server({ 'model.onnx': A }).fetch })).rejects.toThrow(/larger than expected/);
    await expect(downloadModel(model({ a: { size: 6000 } }), tmp, { fetch: server({ 'model.onnx': A }).fetch })).rejects.toThrow(/incomplete/);
    expect(await readdir(tmp)).toEqual([]);
  });

  it('falls back to the next source, which must still match the checksum', async () => {
    const s = server({ 'https://models.example/rev/model.onnx': 503, 'https://mirror.example/rev/model.onnx': A, 'tokens.txt': B });
    await downloadModel(model(), tmp, { fetch: s.fetch });
    expect(await isInstalled(model(), tmp)).toBe(true);
    expect(s.asked).toEqual(['https://models.example/rev/model.onnx', 'https://mirror.example/rev/model.onnx', 'https://models.example/rev/tokens.txt']);
  });

  it('gives up on a source that stalls', async () => {
    const hang = (async (_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    await expect(downloadModel(model(), tmp, { fetch: hang, stallMs: 50 })).rejects.toThrow(/main: no data for too long; mirror: no data for too long/);
  });

  it('tries the China mirror first when asked, and every pinned source uses HTTPS', () => {
    expect(sourcesFor(SENSE_VOICE, true).sources.map((s) => s.name)).toEqual(['modelscope', 'huggingface']);
    expect(sourcesFor(SENSE_VOICE, false).sources.map((s) => s.name)).toEqual(['huggingface', 'modelscope']);
    for (const s of SENSE_VOICE.sources) for (const f of SENSE_VOICE.files) expect(s.url(f.name)).toMatch(/^https:\/\//);
  });

  it('reports server errors and cancellation plainly', async () => {
    await expect(downloadModel(model(), tmp, { fetch: server({ 'model.onnx': 503 }).fetch })).rejects.toThrow(/answered 503/);
    const abort = new AbortController();
    abort.abort();
    await expect(downloadModel(model(), tmp, { fetch: server({ 'model.onnx': A }).fetch, signal: abort.signal })).rejects.toThrow(/cancelled/);
    expect(await readdir(tmp)).toEqual([]);
  });

  it('does not count a file of the wrong size as installed', async () => {
    await writeFile(path.join(tmp, 'model.onnx'), A);
    await writeFile(path.join(tmp, 'tokens.txt'), 'tampered, longer');
    expect(await isInstalled(model(), tmp)).toBe(false);
  });
});

describe('audio from the window', () => {
  it('accepts 16 kHz mono samples within limits and cleans bad values', () => {
    const x = new Float32Array(16000);
    x[0] = Number.NaN;
    x[1] = 5;
    x[2] = -Infinity;
    const y = checkSamples(x);
    expect([y[0], y[1], y[2]]).toEqual([0, 1, 0]);
  });

  it('refuses anything else', () => {
    expect(() => checkSamples([0.1, 0.2])).toThrow(/16 kHz/);
    expect(() => checkSamples(new Float64Array(16000))).toThrow(/16 kHz/);
    expect(() => checkSamples(new Float32Array(100))).toThrow(/too short/);
    expect(() => checkSamples(new Float32Array(16000 * 121))).toThrow(/at most/);
  });
});

describe('transcript tidying', () => {
  it('lower-cases shouted English but keeps exam names, and leaves Chinese alone', () => {
    expect(tidyTranscript('HER IELTS TARGET IS SEVEN. I THINK SHE CAN')).toBe('Her IELTS target is seven. I think she can');
    expect(tidyTranscript('<|zh|><|NEUTRAL|>王一然雅思目标六点五')).toBe('王一然雅思目标六点五');
    expect(tidyTranscript('她 PTE 想考 65')).toBe('她 PTE 想考 65');
    expect(tidyTranscript('Already Mixed case')).toBe('Already Mixed case');
  });
});

// Real model, offline: set TUTORDESK_ASR_MODEL_DIR to a folder with model.int8.onnx, tokens.txt and wavs/zh.wav.
const modelDir = process.env.TUTORDESK_ASR_MODEL_DIR;
describe.skipIf(!modelDir)('SenseVoice (local model)', () => {
  it('transcribes Chinese in well under real time', () => {
    const sherpa = createRequire(import.meta.url)('sherpa-onnx-node');
    const rec = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: { senseVoice: { model: path.join(modelDir!, 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 }, tokens: path.join(modelDir!, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0 },
    });
    const wave = sherpa.readWave(path.join(modelDir!, 'wavs', 'zh.wav'));
    const t = Date.now();
    const s = rec.createStream();
    s.acceptWaveform({ samples: checkSamples(wave.samples), sampleRate: 16000 });
    rec.decode(s);
    expect(rec.getResult(s).text).toContain('九点');
    expect(Date.now() - t).toBeLessThan(5000);
  }, 60_000);
});
