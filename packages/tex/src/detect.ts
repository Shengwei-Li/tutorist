import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { execText, which, type ResolvedCommand } from '@tutordesk/core';
import { REQUIRED_TEX_FILES, type EngineInfo } from './types.js';

const isWin = process.platform === 'win32';
const exe = (name: string) => (isWin ? `${name}.exe` : name);

async function inDir(dir: string, name: string): Promise<ResolvedCommand | null> {
  try {
    const entries = await readdir(dir);
    return entries.includes(exe(name)) ? { command: path.join(dir, exe(name)), prefixArgs: [] } : null;
  } catch {
    return null;
  }
}

/** Common TeX install locations, newest TeX Live year first. Electron launched from Finder has no shell PATH. */
async function knownBinDirs(env: NodeJS.ProcessEnv): Promise<string[]> {
  const dirs: string[] = [];
  const texliveRoots = isWin ? ['C:\\texlive'] : ['/usr/local/texlive'];
  for (const root of texliveRoots) {
    try {
      const years = (await readdir(root)).filter((y) => /^\d{4}$/.test(y)).sort().reverse();
      for (const y of years) {
        if (isWin) dirs.push(path.join(root, y, 'bin', 'windows'), path.join(root, y, 'bin', 'win64'), path.join(root, y, 'bin', 'win32'));
        else {
          const arches = await readdir(path.join(root, y, 'bin')).catch(() => [] as string[]);
          for (const a of arches) dirs.push(path.join(root, y, 'bin', a));
        }
      }
    } catch {
      /* not installed */
    }
  }
  if (isWin && env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'));
  if (isWin && env.ProgramFiles) dirs.push(path.join(env.ProgramFiles, 'MiKTeX', 'miktex', 'bin', 'x64'));
  if (!isWin) dirs.push('/Library/TeX/texbin');
  return dirs;
}

export interface DetectOptions {
  /** User-configured bin directory, tried first. */
  binDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Skip the kpsewhich package check (faster). */
  skipPackageCheck?: boolean;
}

async function describe(xelatex: ResolvedCommand, env: NodeJS.ProcessEnv, skipPackageCheck: boolean): Promise<EngineInfo | null> {
  const ver = await execText(xelatex, ['--version'], { env, timeoutMs: 20_000 });
  if (ver.code !== 0) return null;
  const first = ver.stdout.split(/\r?\n/)[0] ?? '';
  const miktex = /MiKTeX/i.test(ver.stdout);
  const tl = /TeX Live (\d{4})/.exec(ver.stdout);
  const mk = /MiKTeX[- ](\d+(?:\.\d+)*)/.exec(ver.stdout);
  const binDir = path.dirname(xelatex.command);
  const latexmk = (await inDir(binDir, 'latexmk')) ?? undefined;
  const kpsewhich = (await inDir(binDir, 'kpsewhich')) ?? undefined;

  let missingFiles: string[] = [];
  if (kpsewhich && !skipPackageCheck) {
    const r = await execText(kpsewhich, [...REQUIRED_TEX_FILES], { env, timeoutMs: 30_000 });
    const found = new Set(r.stdout.split(/\r?\n/).map((p) => path.basename(p.trim())).filter(Boolean));
    missingFiles = REQUIRED_TEX_FILES.filter((f) => !found.has(f));
  }
  return {
    kind: miktex ? 'system-miktex' : 'system-texlive',
    binDir,
    version: tl ? `TeX Live ${tl[1]}` : mk ? `MiKTeX ${mk[1]}` : first.trim(),
    xelatex,
    latexmk,
    kpsewhich,
    missingFiles,
  };
}

/** Find a usable local TeX installation: configured dir → PATH → well-known install locations. */
export async function detectSystemTex(opts: DetectOptions = {}): Promise<EngineInfo | null> {
  const env = opts.env ?? process.env;
  const candidates: ResolvedCommand[] = [];
  if (opts.binDir) {
    const c = await inDir(opts.binDir, 'xelatex');
    if (c) candidates.push(c);
  }
  const onPath = await which('xelatex', env);
  if (onPath) candidates.push(onPath);
  for (const d of await knownBinDirs(env)) {
    const c = await inDir(d, 'xelatex');
    if (c) candidates.push(c);
  }
  const tried = new Set<string>();
  for (const c of candidates) {
    if (tried.has(c.command.toLowerCase())) continue;
    tried.add(c.command.toLowerCase());
    const info = await describe(c, env, opts.skipPackageCheck ?? false);
    if (info) return info;
  }
  return null;
}
