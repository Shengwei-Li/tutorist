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

  private git(args: string[]) {
    return run('git', args, { cwd: this.dir, windowsHide: true });
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
    await this.git(['add', '-A']);
    const { stdout } = await this.git(['status', '--porcelain']);
    if (!stdout.trim()) return null;
    await this.git(['commit', '-q', '-m', message]);
    const head = await this.git(['rev-parse', '--short', 'HEAD']);
    return head.stdout.trim();
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
