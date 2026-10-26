import { open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

export class LockBusyError extends Error {
  constructor(public readonly holder: LockInfo) {
    super(`Student folder is busy (pid ${holder.pid}, since ${holder.since}: ${holder.purpose})`);
    this.name = 'LockBusyError';
  }
}

export interface LockInfo {
  pid: number;
  since: string;
  purpose: string;
}

const LOCK_FILE = '.tutordesk.lock';
const STALE_MS = 30 * 60 * 1000;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function readLock(file: string): Promise<LockInfo | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

/** One agent run per student at a time (SPEC §3.2). Stale locks (dead pid or >30 min) are broken. */
export async function withDirLock<T>(dir: string, purpose: string, fn: () => Promise<T>): Promise<T> {
  const file = path.join(dir, LOCK_FILE);
  const info: LockInfo = { pid: process.pid, since: new Date().toISOString(), purpose };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(file, 'wx');
      await fh.writeFile(JSON.stringify(info));
      await fh.close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const holder = await readLock(file);
      const stale = !holder || !pidAlive(holder.pid) || Date.now() - Date.parse(holder.since) > STALE_MS;
      if (stale && attempt === 0) {
        await rm(file, { force: true });
        continue;
      }
      throw new LockBusyError(holder ?? { pid: -1, since: '?', purpose: 'unknown' });
    }
  }
  try {
    return await fn();
  } finally {
    await rm(file, { force: true });
  }
}
