import type { ApiGateway } from '../shared/ipc.js';
import { SAMPLE_RATE } from './asr-core.js';

/**
 * Cloud voice input: the recording goes to the tutor's own AI service with their API key. Only gateways
 * that take audio qualify; the others keep voice input on this computer.
 */
export const CLOUD_SPEECH: Partial<Record<ApiGateway, string>> = {
  // Takes audio input on OpenRouter (checked 2026-10-29); about a third of a cent for two minutes.
  openrouter: 'google/gemini-3.8-flash',
  openai: 'gpt-4o-transcribe',
};

export const cloudSpeechModel = (gateway: ApiGateway): string | undefined => CLOUD_SPEECH[gateway];

const TIMEOUT_MS = 60_000;

const PROMPT =
  'Transcribe this recording exactly as spoken. The speaker is a tutor (IELTS / PTE) dictating a message or notes. ' +
  'Write English words in English and Chinese in simplified characters, as they were said; add normal punctuation. ' +
  'Reply with the transcript only: no quotes, labels or comments. If there is no speech, reply with nothing.';

/** 16-bit PCM WAV, mono: the format both services accept. */
export function toWav(samples: Float32Array, rate = SAMPLE_RATE): Buffer {
  const data = samples.length * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  return b;
}

export interface CloudSpeechOptions {
  gateway: ApiGateway;
  apiKey: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/** One recording to text through the tutor's AI service. Errors say what to fix, never the key. */
export async function transcribeInCloud(samples: Float32Array, o: CloudSpeechOptions): Promise<string> {
  const model = cloudSpeechModel(o.gateway);
  if (!model) throw new Error('Cloud voice input needs an OpenRouter or OpenAI key (Settings → API key). Or switch voice input to this computer.');
  if (!o.apiKey) throw new Error('Cloud voice input needs your API key: add it in Settings → API key.');
  const doFetch = o.fetch ?? fetch;
  const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
  const wav = toWav(samples);
  const auth = { Authorization: `Bearer ${o.apiKey}` };

  let res: Response;
  try {
    if (o.gateway === 'openai') {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
      form.append('model', model);
      form.append('response_format', 'json');
      form.append('prompt', 'A tutor dictating notes about IELTS / PTE students, possibly mixing English and Chinese.');
      res = await doFetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: auth, body: form, signal });
    } else {
      res = await doFetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json', 'X-Title': 'TutorDesk' },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 4000,
          messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } }] }],
        }),
        signal,
      });
    }
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new Error('The speech service took too long. Try again, or a shorter recording.');
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error('Could not reach the speech service. Check the internet connection.');
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('The speech service did not accept your API key (Settings → API key).');
    if (res.status === 402) throw new Error('Your AI account is out of credit.');
    if (res.status === 429) throw new Error('The speech service is busy (rate limit). Try again in a moment.');
    throw new Error(`The speech service failed (HTTP ${res.status}).`);
  }
  const body = (await res.json()) as { text?: unknown; choices?: { message?: { content?: unknown } }[] };
  const text = o.gateway === 'openai' ? body.text : body.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('The speech service sent back no text.');
  return text.trim();
}
