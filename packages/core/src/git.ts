import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Thin wrapper over system git used for per-student version history (SPEC §3.2).
 * Every method degrades to a no-op when git is not installed, so history is a bonus, never a requirement.
 */
export class StudentGit {
  private static available: Promise<boolean> | undefined;

  constructor(private readonly dir: string) {}

  static isAvailable(): Promise<boolean> {
    StudentGit.available ??= run('git', ['--version']).then(
      () => true,
      () => false,
    );
    return StudentGit.available;
  }

  /** Per repository: one git operation at a time in this process (the saves of one lesson arrive together). */
  private static queues = new Map<string, Promise<unknown>>();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const key = path.resolve(this.dir).toLowerCase();
    const next = (StudentGit.queues.get(key) ?? Promise.resolve()).then(fn, fn);
    const settled = next.catch(() => {});
    StudentGit.queues.set(key, settled);
    void settled.then(() => {
      if (StudentGit.queues.get(key) === settled) StudentGit.queues.delete(key);
    });
    return next;
  }

  /** The MCP server is another process and can hold the index briefly: a busy index.lock is retried for a few seconds. */
  private async git(args: string[]) {
    for (let i = 0; ; i++) {
      try {
        return await run('git', args, { cwd: this.dir, windowsHide: true });
      } catch (e) {
        if (i >= 20 || !/index\.lock/.test(String((e as { stderr?: string }).stderr ?? e))) throw e;
        await new Promise((r) => setTimeout(r, 100 + i * 50));
      }
    }
  }

  async init(): Promise<boolean> {
    if (!(await StudentGit.isAvailable())) return false;
    try {
      await access(path.join(this.dir, '.git'));
      return true;
    } catch {
      /* not a repo yet */
    }
    await this.git(['init', '-q', '-b', 'main']);
    // Local identity so commits work even when the teacher has no global git config.
    await this.git(['config', 'user.name', 'TutorDesk']);
    await this.git(['config', 'user.email', 'tutordesk@localhost']);
    await this.git(['config', 'core.autocrlf', 'false']);
    return true;
  }

  /** Stage everything and commit; returns the new short hash, or null when nothing changed / git missing. */
  async commitAll(message: string): Promise<string | null> {
    if (!(await StudentGit.isAvailable())) return null;
    return this.exclusive(async () => {
      await this.git(['add', '-A']);
      // What was staged, not what the folder holds now: another save may have written a file since the
      // add, and committing "nothing staged" would fail. That file goes in with the next commit.
      const { stdout } = await this.git(['diff', '--cached', '--name-only']);
      if (!stdout.trim()) return null;
      await this.git(['commit', '-q', '-m', message]);
      const head = await this.git(['rev-parse', '--short', 'HEAD']);
      return head.stdout.trim();
    });
  }

  async log(limit = 20): Promise<{ hash: string; date: string; message: string }[]> {
    if (!(await StudentGit.isAvailable())) return [];
    try {
      const { stdout } = await this.git(['log', `-${limit}`, '--pretty=format:%h%x09%cI%x09%s']);
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [hash = '', date = '', message = ''] = l.split('\t');
          return { hash, date, message };
        });
    } catch {
      return [];
    }
  }
}
