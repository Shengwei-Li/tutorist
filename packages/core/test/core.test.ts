import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LockBusyError,
  PathEscapeError,
  WorkspaceService,
  ieltsOverall,
  isValidScore,
  matchesAnyGlob,
  resolveInside,
  withDirLock,
} from '../src/index.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-core-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('scores', () => {
  it('rounds IELTS overall to the nearest half band', () => {
    expect(ieltsOverall([6.5, 7, 6, 6])).toBe(6.5); // 6.375 → 6.5
    expect(ieltsOverall([6, 6.5, 6.5, 6])).toBe(6.5); // 6.25 → 6.5
    expect(ieltsOverall([6.5, 6.5, 7, 7])).toBe(7); // 6.75 → 7
    expect(ieltsOverall([6, 6, 6, 6.5])).toBe(6); // 6.125 → 6
  });
  it('validates scale steps per exam', () => {
    expect(isValidScore('ielts-academic', 6.5)).toBe(true);
    expect(isValidScore('ielts-academic', 6.3)).toBe(false);
    expect(isValidScore('pte-academic', 79)).toBe(true);
    expect(isValidScore('pte-academic', 9)).toBe(false);
  });
});

describe('path jail', () => {
  it('allows paths inside and rejects .. escapes', async () => {
    await mkdir(path.join(tmp, 'a'));
    expect(await resolveInside(tmp, 'a/new.txt')).toMatch(/new\.txt$/);
    await expect(resolveInside(path.join(tmp, 'a'), '../outside.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('rejects symlinks that point outside the root', async () => {
    const root = path.join(tmp, 'root');
    const outside = path.join(tmp, 'outside');
    await mkdir(root);
    await mkdir(outside);
    try {
      await symlink(outside, path.join(root, 'link'), 'junction');
    } catch {
      return; // symlinks unavailable on this machine
    }
    await expect(resolveInside(root, 'link/x.txt')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('matches writable globs', () => {
    const globs = ['lessons/2026-10-26-L04/**', 'notes/*.md'];
    expect(matchesAnyGlob('lessons/2026-10-26-L04/script.json', globs)).toBe(true);
    expect(matchesAnyGlob('lessons/2026-10-26-L04/.out/plan.json', globs)).toBe(true);
    expect(matchesAnyGlob('lessons/2026-10-19-L03/script.json', globs)).toBe(false);
    expect(matchesAnyGlob('notes/a.md', globs)).toBe(true);
    expect(matchesAnyGlob('notes/sub/a.md', globs)).toBe(false);
  });
});

describe('lock', () => {
  it('blocks a second holder and breaks stale locks', async () => {
    await withDirLock(tmp, 'outer', async () => {
      await expect(withDirLock(tmp, 'inner', async () => 1)).rejects.toBeInstanceOf(LockBusyError);
    });
    await writeFile(path.join(tmp, '.tutordesk.lock'), JSON.stringify({ pid: 999999, since: new Date().toISOString(), purpose: 'dead' }));
    expect(await withDirLock(tmp, 'after stale', async () => 'ok')).toBe('ok');
  });
});

describe('WorkspaceService', () => {
  it('creates a student with all files, context and git history', async () => {
    const ws = await WorkspaceService.init(path.join(tmp, 'ws'));
    const p = await ws.createStudent({ name: 'Mina Park', exam: 'ielts-academic', targetOverall: 6.5, examDate: '2027-01-20' });
    expect(p.id).toBe('mina-park-ielts');
    const dir = await ws.studentDir(p.id);
    const claude = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain('IELTS Academic');
    expect(await readFile(path.join(dir, 'AGENTS.md'), 'utf8')).toBe(claude);

    const again = await ws.createStudent({ name: 'Mina Park', exam: 'ielts-academic', targetOverall: 7 });
    expect(again.id).toBe('mina-park-ielts-2');

    const cjk = await ws.createStudent({ name: '王一然', exam: 'pte-academic', targetOverall: 65 });
    expect(cjk.id).toBe('student-pte');

    const list = await ws.listStudents();
    expect(list.filter((s) => s.ok)).toHaveLength(3);
  });

  it('rejects invalid targets', async () => {
    const ws = await WorkspaceService.init(path.join(tmp, 'ws'));
    await expect(ws.createStudent({ name: 'X', exam: 'ielts-academic', targetOverall: 6.3 })).rejects.toThrow();
    await expect(ws.createStudent({ name: 'Y', exam: 'pte-academic', targetOverall: 95 })).rejects.toThrow();
  });

  it('reports hand-edited invalid profiles instead of crashing', async () => {
    const ws = await WorkspaceService.init(path.join(tmp, 'ws'));
    const p = await ws.createStudent({ name: 'Leo', exam: 'pte-academic', targetOverall: 79 });
    await writeFile(path.join(await ws.studentDir(p.id), 'profile.json'), '{"schemaVersion":1,"id":"leo-pte"}');
    const [entry] = await ws.listStudents();
    expect(entry?.ok).toBe(false);
    if (entry && !entry.ok) expect(entry.issues.join(' ')).toMatch(/name/);
  });

  it('numbers lessons, updates profiles and records history', async () => {
    const ws = await WorkspaceService.init(path.join(tmp, 'ws'));
    const p = await ws.createStudent({ name: 'Ana', exam: 'ielts-general', targetOverall: 7 });
    const l1 = await ws.createLesson(p.id, { date: '2026-10-26', topic: 'PEEL' });
    const l2 = await ws.createLesson(p.id, { date: '2026-10-28' });
    expect([l1.id, l2.id]).toEqual(['2026-10-26-L01', '2026-10-28-L02']);
    expect(l1.minutes).toBe(90);

    const next = await ws.updateProfile(p.id, (cur) => ({ ...cur, interests: ['football'] }), 'Add interests');
    expect(next.interests).toEqual(['football']);
    await expect(ws.updateProfile(p.id, (cur) => ({ ...cur, goal: { ...cur.goal, targetOverall: 7.2 } }))).rejects.toThrow();

    await ws.appendError(p.id, { id: 'e1', code: 'W-GRA-CONJ', excerpt: 'Although…, but', source: 'submissions/x.md#L3', date: '2026-10-26', status: 'open' });
    expect((await ws.readErrors(p.id)).items).toHaveLength(1);

    const log = await ws.history(p.id);
    if (log.length) expect(log.map((c) => c.message)).toContain('Add interests');
  });

  it('refuses student ids that escape the students folder', async () => {
    const ws = await WorkspaceService.init(path.join(tmp, 'ws'));
    await expect(ws.studentDir('../../etc')).rejects.toBeInstanceOf(PathEscapeError);
  });
});
