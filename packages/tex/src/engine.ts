import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { killTree, resolveInside, type ResolvedCommand } from '@tutordesk/core';
import { detectTex, type DetectOptions } from './detect.js';
import { parseTexLog } from './log-parser.js';
import type { CompileJob, CompileResult, EngineInfo } from './types.js';

function runProcess(
  cmd: ResolvedCommand,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; signal?: AbortSignal },
): Promise<{ code: number | null; output: string; timedOut: boolean; aborted: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd.command, [...cmd.prefixArgs, ...args], {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    const collect = (c: Buffer) => {
      output = (output + c.toString('utf8')).slice(-200_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, opts.timeoutMs);
    const onAbort = () => killTree(child);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      output += `\n${e.message}`;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code, output, timedOut, aborted: opts.signal?.aborted ?? false });
    });
  });
}

/** Copy templates and expose fonts/ inside the build dir so `Path=fonts/` resolves (appendix D.3). */
async function stageTemplates(templateDir: string, buildDir: string): Promise<void> {
  for (const f of await readdir(templateDir)) {
    if (/\.(cls|sty|def|cfg)$/i.test(f)) await copyFile(path.join(templateDir, f), path.join(buildDir, f));
  }
  const fontsSrc = path.join(templateDir, 'fonts');
  const fontsDst = path.join(buildDir, 'fonts');
  if (await stat(fontsDst).catch(() => null)) return;
  try {
    await symlink(fontsSrc, fontsDst, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    await mkdir(fontsDst, { recursive: true });
    for (const f of await readdir(fontsSrc)) {
      if (/\.(otf|ttf)$/i.test(f)) await copyFile(path.join(fontsSrc, f), path.join(fontsDst, f));
    }
  }
}

export class TexEngine {
  private info: Promise<EngineInfo | null> | undefined;
  private latest = new Map<string, AbortController>();
  private running = 0;
  private waiters: (() => void)[] = [];

  constructor(
    private readonly opts: DetectOptions & { maxConcurrent?: number } = {},
  ) {}

  detect(refresh = false): Promise<EngineInfo | null> {
    if (refresh || !this.info) this.info = detectTex(this.opts);
    return this.info;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    const max = this.opts.maxConcurrent ?? Math.max(1, Math.floor(os.cpus().length / 2));
    while (this.running >= max) await new Promise<void>((r) => this.waiters.push(r));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiters.shift()?.();
    }
  }

  /** Compile, cancelling any in-flight compile of the same document (latest edit wins). */
  compileLatest(docKey: string, job: CompileJob): Promise<CompileResult> {
    this.latest.get(docKey)?.abort();
    const ac = new AbortController();
    this.latest.set(docKey, ac);
    job.signal?.addEventListener('abort', () => ac.abort(), { once: true });
    return this.compile({ ...job, signal: ac.signal }).finally(() => {
      if (this.latest.get(docKey) === ac) this.latest.delete(docKey);
    });
  }

  async compile(job: CompileJob): Promise<CompileResult> {
    const started = Date.now();
    const info = await this.detect();
    if (!info) {
      return { ok: false, log: '', errors: [{ severity: 'error', message: 'No TeX installation found' }], durationMs: 0, engine: { kind: 'system-texlive', version: 'none' } };
    }
    const engine = { kind: info.kind, version: info.version };
    const temp = !job.buildDir;
    const buildDir = job.buildDir ?? (await mkdtemp(path.join(os.tmpdir(), 'tutordesk-tex-')));
    await mkdir(buildDir, { recursive: true });
    const jobname = job.jobname ?? 'main';

    try {
      await stageTemplates(job.templateDir, buildDir);
      // Tectonic takes no pre-TeX code on its command line: a small wrapper sets it, then reads the document.
      const wrap = info.kind === 'tectonic' && !!job.pretex;
      const bodyFile = wrap ? `${jobname}-body.tex` : `${jobname}.tex`;
      await writeFile(path.join(buildDir, bodyFile), job.mainTex, 'utf8');
      if (wrap) await writeFile(path.join(buildDir, `${jobname}.tex`), `${job.pretex}\\input{${bodyFile}}\n`, 'utf8');
      for (const [rel, content] of Object.entries(job.files ?? {})) {
        const target = await resolveInside(buildDir, rel);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      await rm(path.join(buildDir, `${jobname}.pdf`), { force: true });

      // Sandbox: no shell escape, no writing or reading outside the build dir, no user TEXMF tree.
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        openout_any: 'p',
        openin_any: 'p',
        TEXMFHOME: path.join(buildDir, '.texmf-none'),
        TEXMFVAR: path.join(os.tmpdir(), 'tutordesk-texmf-var'),
        max_print_line: '10000',
      };
      const timeoutMs = job.timeoutMs ?? 60_000;
      const xeArgs = ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-synctex=1', '-no-shell-escape'];
      // xelatex is run directly, never through latexmk: on Windows latexmk's wrapper starts xelatex
      // outside the process tree, so a cancelled or timed-out compile left a runaway TeX process behind.
      // Passes repeat while the .aux file changes (as latexmk would), all within one time budget.
      const src = job.pretex ? `${job.pretex}\\input{${jobname}.tex}` : `${jobname}.tex`;
      const auxFile = path.join(buildDir, `${jobname}.aux`);
      const deadline = Date.now() + timeoutMs;
      let run: Awaited<ReturnType<typeof runProcess>> = { code: 0, output: '', timedOut: false, aborted: false };
      let previousAux = await readFile(auxFile, 'utf8').catch(() => '');
      if (info.kind === 'tectonic') {
        // Offline from the bundled cache, no shell escape; Tectonic reruns the passes itself.
        run = await runProcess(info.xelatex, ['-X', 'compile', `${jobname}.tex`, '--untrusted', '--only-cached', '--keep-logs', '--synctex'], {
          cwd: buildDir,
          env: { ...env, TECTONIC_CACHE_DIR: info.cacheDir },
          timeoutMs,
          signal: job.signal,
        });
      }
      for (let pass = 0; pass < 4 && info.kind !== 'tectonic'; pass++) {
        run = await runProcess(info.xelatex, [...xeArgs, `-jobname=${jobname}`, src], { cwd: buildDir, env, timeoutMs: Math.max(1000, deadline - Date.now()), signal: job.signal });
        if (run.code !== 0 || run.timedOut || run.aborted) break;
        const aux = await readFile(auxFile, 'utf8').catch(() => '');
        const log = await readFile(path.join(buildDir, `${jobname}.log`), 'utf8').catch(() => '');
        if (aux === previousAux && !/Rerun to get|Label\(s\) may have changed|rerunfilecheck/i.test(log)) break;
        previousAux = aux;
      }

      const log = await readFile(path.join(buildDir, `${jobname}.log`), 'utf8').catch(() => run.output);
      const errors = parseTexLog(log, job.lineMap);
      if (run.timedOut) errors.unshift({ severity: 'error', message: `Compile timed out after ${Math.round(timeoutMs / 1000)} s` });
      if (run.aborted) errors.unshift({ severity: 'error', message: 'Compile cancelled' });
      const pdfPath = path.join(buildDir, `${jobname}.pdf`);
      const pdf = await readFile(pdfPath).catch(() => undefined);
      const ok = run.code === 0 && !run.timedOut && !run.aborted && pdf !== undefined && !errors.some((e) => e.severity === 'error');
      if (!ok && !errors.some((e) => e.severity === 'error')) {
        errors.push({ severity: 'error', message: `TeX exited with code ${run.code}`, context: run.output.slice(-500) });
      }
      return { ok, pdf, pdfPath: temp ? undefined : pdfPath, log, errors, durationMs: Date.now() - started, engine, timedOut: run.timedOut };
    } finally {
      if (temp) await rm(buildDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
