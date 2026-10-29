import { describe, expect, it } from 'vitest';
import { toWav, transcribeInCloud } from '../src/main/asr-cloud.js';

const second = new Float32Array(16_000).map((_, i) => Math.sin(i / 10) * 0.5);

/** A fetch that records the request and answers with `reply`. */
function fake(reply: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('toWav', () => {
  it('writes 16-bit mono PCM at 16 kHz, clipping out-of-range samples', () => {
    const w = toWav(new Float32Array([0, 1, -1, 2]));
    expect(w.toString('ascii', 0, 4)).toBe('RIFF');
    expect(w.toString('ascii', 8, 12)).toBe('WAVE');
    expect(w.readUInt16LE(22)).toBe(1);
    expect(w.readUInt32LE(24)).toBe(16_000);
    expect(w.readUInt32LE(40)).toBe(8);
    expect([0, 1, 2, 3].map((i) => w.readInt16LE(44 + i * 2))).toEqual([0, 32767, -32767, 32767]);
  });
});

describe('transcribeInCloud', () => {
  it('sends the recording to OpenRouter as wav audio and returns the text', async () => {
    const { f, calls } = fake({ choices: [{ message: { content: '  Lily did well on Task 2.\n' } }] });
    expect(await transcribeInCloud(second, { gateway: 'openrouter', apiKey: 'k', fetch: f })).toBe('Lily did well on Task 2.');
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.model).toBe('google/gemini-3.8-flash');
    const audio = body.messages[0].content.find((c: { type: string }) => c.type === 'input_audio');
    expect(audio.input_audio.format).toBe('wav');
    expect(Buffer.from(audio.input_audio.data, 'base64').length).toBe(44 + 32_000);
  });

  it('uses the transcription endpoint on OpenAI', async () => {
    const { f, calls } = fake({ text: 'Hello' });
    expect(await transcribeInCloud(second, { gateway: 'openai', apiKey: 'k', fetch: f })).toBe('Hello');
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-transcribe');
    expect((form.get('file') as Blob).size).toBe(44 + 32_000);
  });

  it('refuses services that take no audio, and a missing key, without a request', async () => {
    const { f, calls } = fake({});
    await expect(transcribeInCloud(second, { gateway: 'anthropic', apiKey: 'k', fetch: f })).rejects.toThrow(/OpenRouter or OpenAI/);
    await expect(transcribeInCloud(second, { gateway: 'openrouter', apiKey: '', fetch: f })).rejects.toThrow(/API key/);
    expect(calls).toHaveLength(0);
  });

  it('turns HTTP failures into plain messages that never include the key', async () => {
    for (const [status, msg] of [[401, /did not accept/], [402, /credit/], [429, /busy/], [500, /HTTP 500/]] as const) {
      const err = await transcribeInCloud(second, { gateway: 'openrouter', apiKey: 'sk-secret', fetch: fake({}, status).f }).catch((e: Error) => e);
      expect((err as Error).message).toMatch(msg);
      expect((err as Error).message).not.toContain('sk-secret');
    }
  });

  it('rejects a reply without text', async () => {
    await expect(transcribeInCloud(second, { gateway: 'openrouter', apiKey: 'k', fetch: fake({ choices: [] }).f })).rejects.toThrow(/no text/);
  });
});
