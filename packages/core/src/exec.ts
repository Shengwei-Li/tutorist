import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ResolvedCommand {
  command: string;
  prefixArgs: string[];
}

const isWin = process.platform === 'win32';

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATH ?? env.Path ?? '';
  const dirs = raw.split(path.delimiter).filter(Boolean);
  // Electron apps launched from Finder/Explorer may miss user-level install dirs.
  if (isWin && env.APPDATA) dirs.push(path.join(env.APPDATA, 'npm'));
  if (!isWin) dirs.push('/usr/local/bin', '/opt/homebrew/bin', path.join(env.HOME ?? '', '.local/bin'));
  return [...new Set(dirs)];
}

/**
 * Parse an npm-generated .cmd shim and return the real target. Spawning .cmd files needs a shell on
 * Windows, which mangles JSON arguments, so we always launch the underlying .exe or .js directly.
 */
export async function parseCmdShim(shimPath: string): Promise<ResolvedCommand | null> {
  const text = await readFile(shimPath, 'utf8');
  const dir = path.dirname(shimPath);
  const targets = [...text.matchAll(/"%(?:dp0|~dp0)%\\?([^"]+)"/gi)].map((m) => m[1]!);
  const target = targets.reverse().find((t) => !/node(\.exe)?$/i.test(t));
  if (!target) return null;
  const full = path.join(dir, target);
  if (/\.(c|m)?js$/i.test(full)) {
    const node = await which('node');
    return node ? { command: node.command, prefixArgs: [full] } : null;
  }
  return { command: full, prefixArgs: [] };
}

/** Locate an executable the way a shell would, resolving npm shims on Windows. */
export async function which(name: string, env: NodeJS.ProcessEnv = process.env): Promise<ResolvedCommand | null> {
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathDirs(env)) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (!(await fileExists(candidate))) continue;
      if (isWin && /\.(cmd|bat)$/i.test(candidate)) {
        const resolved = await parseCmdShim(candidate);
        if (resolved) return resolved;
        continue;
      }
      if (isWin && ext === '') continue; // extensionless files on Windows are sh scripts for Git Bash
      return { command: candidate, prefixArgs: [] };
    }
  }
  return null;
}

export function execText(
  cmd: ResolvedCommand,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd.command,
      [...cmd.prefixArgs, ...args],
      { cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs ?? 30_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** Kill a child and all its descendants (agent CLIs spawn tool subprocesses). */
export function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (isWin) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

/** Split a byte stream into complete lines, tolerating chunks that end mid-line. */
export class LineSplitter {
  private buf = '';
  push(chunk: string): string[] {
    this.buf += chunk;
    const parts = this.buf.split(/\r?\n/);
    this.buf = parts.pop() ?? '';
    return parts.filter((l) => l.trim().length > 0);
  }
  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = '';
    return rest ? [rest] : [];
  }
}
