import { createRequire } from 'node:module';
import path from 'node:path';

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

type Request = { type: 'load'; dir: string } | { type: 'transcribe'; id: number; samples: Float32Array };

// Not named `require`: electron-vite adds a shim of that name to ESM main bundles.
const nodeRequire = createRequire(import.meta.url);
let recognizer: Recognizer | null = null;

process.parentPort.on('message', (e: { data: Request }) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      const sherpa = nodeRequire('sherpa-onnx-node') as { OfflineRecognizer: new (config: unknown) => Recognizer };
      recognizer = new sherpa.OfflineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          senseVoice: { model: path.join(m.dir, 'model.int8.onnx'), language: 'auto', useInverseTextNormalization: 1 },
          tokens: path.join(m.dir, 'tokens.txt'),
          numThreads: 2,
          provider: 'cpu',
          debug: 0,
        },
      });
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
