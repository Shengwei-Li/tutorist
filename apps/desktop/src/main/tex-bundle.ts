import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { BundledTectonic, DetectOptions } from '@tutordesk/tex';
import { loadSettings } from './settings.js';

/**
 * The Tectonic that ships with the app (fetched at build time by scripts/fetch-tectonic.mjs), so tutors
 * with no TeX installed can still export PDFs, offline. Missing in a development checkout that has not
 * fetched it; then only the system TeX is used.
 */
export function bundledTectonic(): BundledTectonic | undefined {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'tectonic') : path.resolve(app.getAppPath(), 'resources', 'tectonic');
  const binary = path.join(root, 'bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'tectonic.exe' : 'tectonic');
  const cacheDir = path.join(root, 'cache');
  return existsSync(binary) && existsSync(cacheDir) ? { binary, cacheDir } : undefined;
}

/** How to find TeX: the tutor's TeX if it is complete, else the bundled Tectonic. TUTORDESK_TEX_ENGINE=bundled skips the system TeX. */
export async function texOptions(): Promise<Pick<DetectOptions, 'binDir' | 'bundled' | 'prefer'>> {
  const { texBinDir } = await loadSettings();
  return { binDir: texBinDir, bundled: bundledTectonic(), prefer: process.env.TUTORDESK_TEX_ENGINE === 'bundled' ? 'bundled' : 'auto' };
}
