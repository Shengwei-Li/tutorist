import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Workspace packages ship TypeScript sources, so they are bundled rather than externalized.
const bundled = ['@tutordesk/core', '@tutordesk/providers', '@tutordesk/tex', '@tutordesk/ui', '@tutordesk/render', '@tutordesk/pipeline', '@tutordesk/toolbox', '@tutordesk/harness', 'zod'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: bundled },
      // The speech recognizer runs in its own utility process (src/main/asr.ts).
      rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/main/index.ts'), 'asr-worker': resolve(import.meta.dirname, 'src/main/asr-worker.ts') } },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: bundled },
      // Sandboxed preloads must be CommonJS.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(import.meta.dirname, 'src/renderer/index.html') } },
    plugins: [react(), tailwindcss()],
  },
});
