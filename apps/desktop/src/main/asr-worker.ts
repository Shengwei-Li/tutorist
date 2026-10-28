import { createRequire } from 'node:module';

/**
 * Speech recognizer process (Electron utility process). Holds the SenseVoice model in its own memory
 * so the app does not carry it when voice input is not in use, and a native crash cannot take the
 * app down. Talks only to the main process; it never touches the network or the workspace.
 */

interface Recognizer {
  createStream(): { acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void };
  decode(stream: unknown): void;
  getResult(stream: unknown): { text: string };
}

/** `config` is built by the main process (asr-core.ts recognizerConfig): model paths and threads. */
type Request = { type: 'load'; config: Record<string, unknown> } | { type: 'transcribe'; id: number; samples: Float32Array };

// Not named `require`: electron-vite adds a shim of that name to ESM main bundles.
const nodeRequire = createRequire(import.meta.url);
let recognizer: Recognizer | null = null;

process.parentPort.on('message', (e: { data: Request }) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      const sherpa = nodeRequire('sherpa-onnx-node') as { OfflineRecognizer: new (config: unknown) => Recognizer };
      recognizer = new sherpa.OfflineRecognizer(m.config);
      process.parentPort.postMessage({ type: 'loaded' });
      return;
    }
    if (!recognizer) throw new Error('The speech model is not loaded.');
    const stream = recognizer.createStream();
    stream.acceptWaveform({ samples: m.samples, sampleRate: 16000 });
    recognizer.decode(stream);
    process.parentPort.postMessage({ type: 'result', id: m.id, text: recognizer.getResult(stream).text });
  } catch (err) {
    process.parentPort.postMessage({ type: 'error', id: m.type === 'transcribe' ? m.id : undefined, message: (err as Error).message });
  }
});
