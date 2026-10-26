import { realpath } from 'node:fs/promises';
import path from 'node:path';

export class PathEscapeError extends Error {
  constructor(public readonly requested: string, public readonly root: string) {
    super(`Path escapes workspace: ${requested}`);
    this.name = 'PathEscapeError';
  }
}

/** realpath that tolerates not-yet-existing leaves by resolving the nearest existing ancestor. */
async function realpathLoose(p: string): Promise<string> {
  const tail: string[] = [];
  let cur = p;
  for (;;) {
    try {
      const real = await realpath(cur);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve `requested` (relative to root, or absolute) and guarantee the real path stays inside root.
 * Symlinks and `..` segments that leave the root are rejected (SPEC §7.8).
 */
export async function resolveInside(root: string, requested: string): Promise<string> {
  const rootReal = await realpath(root);
  const target = await realpathLoose(path.resolve(rootReal, requested));
  if (!isWithin(rootReal, target)) throw new PathEscapeError(requested, rootReal);
  return target;
}

/** Minimal glob → RegExp: supports `**`, `*`, `?`. Patterns use forward slashes and are root-relative. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAnyGlob(relPath: string, globs: readonly string[]): boolean {
  const norm = relPath.split(path.sep).join('/');
  return globs.some((g) => globToRegExp(g).test(norm));
}

export function toPosixRelative(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}
