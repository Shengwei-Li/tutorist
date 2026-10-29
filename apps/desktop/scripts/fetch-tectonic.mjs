#!/usr/bin/env node
/**
 * Build step: fetch the pinned Tectonic for this platform and warm its offline cache, so the app can
 * typeset with no TeX installed and no network (appendix D.3).
 *
 *   node scripts/fetch-tectonic.mjs          → resources/tectonic/bin/<platform>-<arch>/, resources/tectonic/cache/
 *
 * The archive is checked against its SHA-256 before anything is unpacked. Warming the cache compiles
 * every sample (both editions, all four deck themes) once with network access, then once more offline
 * to prove the cache is complete. resources/tectonic is git-ignored.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.17.0';
const ASSETS = {
  'win32-x64': { name: 'x86_64-pc-windows-msvc.zip', sha256: 'f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f' },
  'darwin-arm64': { name: 'aarch64-apple-darwin.tar.gz', sha256: 'a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667' },
  'darwin-x64': { name: 'x86_64-apple-darwin.tar.gz', sha256: '7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80' },
  'linux-x64': { name: 'x86_64-unknown-linux-gnu.tar.gz', sha256: '1a715688baf591e650c8aeb160ae934e181685eecbb38b317de30b269ac5d606' },
};
/** Tectonic's default bundle (TeX Live 2022) as of 0.17.0; the cache must come from exactly this one. */
const BUNDLE_DIGEST = '6ffe055852f8faf66c0acbe1a7fb27f87b869a90bad1204f3bf4d9683f597c7c';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'resources', 'tectonic');
const templates = path.resolve(here, '..', '..', '..', 'workspace-template', 'templates', 'tex');
const target = `${process.platform}-${process.arch}`;
const asset = ASSETS[target];
if (!asset) throw new Error(`No pinned Tectonic for ${target}`);
const exe = process.platform === 'win32' ? 'tectonic.exe' : 'tectonic';
const binDir = path.join(out, 'bin', target);
const binary = path.join(binDir, exe);
const cacheDir = path.join(out, 'cache');

async function fetchBinary() {
  if (await stat(binary).catch(() => null)) return console.log(`Tectonic ${VERSION} already in ${binDir}`);
  const file = `tectonic-${VERSION}-${asset.name}`;
  const url = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}/${file}`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const sha = createHash('sha256').update(data).digest('hex');
  if (sha !== asset.sha256) throw new Error(`SHA-256 mismatch for ${file}: ${sha}`);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'tectonic-'));
  try {
    await writeFile(path.join(tmp, file), data);
    // bsdtar reads both zip and tar.gz. On Windows name the system one: Git's GNU tar may come first on PATH.
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const r = spawnSync(tar, ['-xf', file], { cwd: tmp, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('Could not unpack the Tectonic archive');
    await mkdir(binDir, { recursive: true });
    await cp(path.join(tmp, exe), binary);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Every document the app makes: three kinds in both editions, and the deck in each theme. */
function jobs() {
  const list = [];
  for (const sample of ['handout-peel', 'worksheet-mixed', 'lesson-script'])
    for (const pretex of ['', '\\def\\TDmode{teacher}']) list.push({ sample, pretex });
  for (const theme of ['tutorswiss', 'tutorbook', 'tutorsheet', 'tutorfocus']) list.push({ sample: 'deck', theme });
  return list;
}

async function compileAll(offline) {
  for (const job of jobs()) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tectonic-warm-'));
    try {
      for (const f of await readdir(templates)) if (/\.(cls|sty)$/.test(f)) await cp(path.join(templates, f), path.join(dir, f));
      await cp(path.join(templates, 'fonts'), path.join(dir, 'fonts'), { recursive: true });
      await cp(path.join(templates, 'samples', 'lesson-peel.tex'), path.join(dir, 'lesson-peel.tex'));
      let body = await readFile(path.join(templates, 'samples', `${job.sample}.tex`), 'utf8');
      if (job.theme) body = body.replace(/\\usetheme\{[^}]*\}/, `\\usetheme{${job.theme}}`);
      await writeFile(path.join(dir, 'body.tex'), body);
      await writeFile(path.join(dir, 'main.tex'), `${job.pretex ?? ''}\\input{body.tex}\n`);
      const args = ['-X', 'compile', 'main.tex', '--untrusted', ...(offline ? ['--only-cached'] : [])];
      const r = spawnSync(binary, args, { cwd: dir, env: { ...process.env, TECTONIC_CACHE_DIR: cacheDir }, encoding: 'utf8' });
      const label = `${job.sample}${job.theme ? ` (${job.theme})` : job.pretex ? ' (teacher)' : ''}`;
      if (r.status !== 0) throw new Error(`${offline ? 'Offline' : 'Warm-up'} compile failed: ${label}\n${r.stdout}${r.stderr}`);
      console.log(`${offline ? 'offline ok' : 'warmed'}  ${label}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

await fetchBinary();
await compileAll(false);
if (!(await stat(path.join(cacheDir, 'bundles', 'data', BUNDLE_DIGEST)).catch(() => null)))
  throw new Error(`The cache is not from the pinned bundle ${BUNDLE_DIGEST}: Tectonic's default bundle changed. Check it, then update BUNDLE_DIGEST.`);
await compileAll(true);
console.log(`Tectonic ${VERSION} and its offline cache are ready in ${out}`);
