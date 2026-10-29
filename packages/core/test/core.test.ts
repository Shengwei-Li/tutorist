import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LockBusyError,
  PathEscapeError,
  StudentGit,
  SubmissionMeta,
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

describe.skipIf(!(await StudentGit.isAvailable()))('StudentGit', () => {
  it('records every save when several arrive at the same moment', async () => {
    const git = new StudentGit(tmp);
    await git.init();
    const docs = ['handout', 'worksheet', 'script', 'deck', 'plan', 'notes'];
    await Promise.all(
      docs.map(async (d) => {
        await writeFile(path.join(tmp, `${d}.json`), '{}');
        return git.commitAll(`Save ${d}`);
      }),
    );
    const log = await git.log(20);
    // Every file is committed and no save failed; saves that landed together may share a commit.
    expect(log.length).toBeGreaterThan(0);
    expect(await new StudentGit(tmp).commitAll('nothing left')).toBeNull();
  });

  it('commits what it staged even when a file appears right after', async () => {
    const git = new StudentGit(tmp);
    await git.init();
    await writeFile(path.join(tmp, 'a.json'), '{}');
    // Written while the commit is under way, as an exported PDF can be.
    const [hash] = await Promise.all([git.commitAll('Save a'), writeFile(path.join(tmp, 'b.pdf'), 'x')]);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    await git.commitAll('Save b');
    expect(await git.commitAll('nothing left')).toBeNull();
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
    // A refused student leaves no folder behind.
    expect(await readdir(path.join(ws.root, 'students')).catch(() => [])).toEqual([]);
  });

  it('gives two students of the same name made at the same moment their own folders', async () => {
    const ws = await WorkspaceService.init(path.join(tmp, 'ws'));
    const made = await Promise.all([1, 2, 3].map(() => ws.createStudent({ name: 'Li Wei', exam: 'ielts-academic', targetOverall: 6.5 })));
    expect(new Set(made.map((p) => p.id)).size).toBe(3);
    expect((await ws.listStudents()).filter((s) => s.ok)).toHaveLength(3);
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
    // Every id names exactly one folder: not the students folder itself, not a path inside a student.
    for (const id of ['', '.', '..', 'a/b', 'a\\b']) await expect(ws.studentDir(id)).rejects.toBeInstanceOf(PathEscapeError);
    const s = await ws.createStudent({ name: 'Mina Park', exam: 'ielts-academic', targetOverall: 6.5 });
    for (const id of ['.', '..', '../lessons']) {
      await expect(ws.lessonDir(s.id, id)).rejects.toBeInstanceOf(PathEscapeError);
      await expect(ws.submissionDir(s.id, id)).rejects.toBeInstanceOf(PathEscapeError);
    }
  });

  it('keeps an essay photo to a file name in its own folder', () => {
    const meta = { schemaVersion: 1, id: '2026-10-29-task2', kind: 'writing-task2', source: 'image', original: 'original.jpg', createdAt: '2026-10-29T09:00:00.000Z' };
    expect(SubmissionMeta.safeParse(meta).success).toBe(true);
    for (const original of ['../../profile.png', 'C:/Users/x/a.png', 'original.png/../x.png']) expect(SubmissionMeta.safeParse({ ...meta, original }).success).toBe(false);
  });
});

describe('editing and removing', () => {
  async function setup() {
    const ws = await WorkspaceService.init(path.join(tmp, 'ws'));
    const p = await ws.createStudent({ name: 'Mina Park', exam: 'ielts-academic', targetOverall: 6.5, delivery: { mode: 'offline', sessionsPerWeek: 1, minutesPerSession: 60 } });
    return { ws, p };
  }

  it('records the lesson schedule the tutor gave, not a default', async () => {
    const { ws, p } = await setup();
    expect(p.delivery).toMatchObject({ mode: 'offline', sessionsPerWeek: 1, minutesPerSession: 60 });
    expect(p.archived).toBe(false);
    const l = await ws.createLesson(p.id, { date: '2026-11-02' });
    expect(l.minutes).toBe(60);
  });

  it('moves lessons, lists them by date and deletes one', async () => {
    const { ws, p } = await setup();
    const a = await ws.createLesson(p.id, { date: '2026-11-05' });
    const b = await ws.createLesson(p.id, { date: '2026-11-01' });
    expect((await ws.listLessons(p.id)).map((l) => l.id)).toEqual([b.id, a.id]);
    await ws.updateLesson(p.id, b.id, (l) => ({ ...l, date: '2026-11-09', status: 'taught' }), `Update lesson ${b.id}`);
    expect((await ws.listLessons(p.id)).map((l) => l.id)).toEqual([a.id, b.id]);
    await ws.deleteLesson(p.id, a.id);
    expect((await ws.listLessons(p.id)).map((l) => l.id)).toEqual([b.id]);
    expect((await ws.history(p.id, 1))[0]!.message).toBe(`Delete lesson ${a.id}`);
    await expect(ws.deleteLesson(p.id, '../../x')).rejects.toBeInstanceOf(PathEscapeError);
  });

  it('deletes an essay', async () => {
    const { ws, p } = await setup();
    const s = await ws.createSubmission(p.id, { kind: 'writing-task2', text: 'An essay.', date: '2026-11-01' });
    await ws.deleteSubmission(p.id, s.id);
    expect(await ws.listSubmissions(p.id)).toEqual([]);
  });

  it('marks and removes error log entries, keeping lines it cannot read', async () => {
    const { ws, p } = await setup();
    const e = { code: 'W-TR-POS', excerpt: 'x', source: 'submissions/a', date: '2026-11-01' };
    await ws.appendError(p.id, { ...e, id: 'e1', status: 'open' });
    await ws.appendError(p.id, { ...e, id: 'e2', status: 'open' });
    const file = path.join(await ws.studentDir(p.id), 'error-log.jsonl');
    await writeFile(file, `${await readFile(file, 'utf8')}not json\n`);
    await ws.updateErrors(p.id, (x) => (x.id === 'e1' ? { ...x, status: 'resolved' } : x), 'Mark error e1 resolved');
    await ws.updateErrors(p.id, (x) => (x.id === 'e2' ? null : x), 'Remove error e2');
    const r = await ws.readErrors(p.id);
    expect(r.items.map((x) => [x.id, x.status])).toEqual([['e1', 'resolved']]);
    expect(r.bad).toHaveLength(1);
  });

  it('archives a student and moves a deleted one to the trash with its history', async () => {
    const { ws, p } = await setup();
    const archived = await ws.updateProfile(p.id, (x) => ({ ...x, archived: true }), 'Archive student');
    expect(archived.archived).toBe(true);
    const dest = await ws.deleteStudent(p.id);
    expect(dest).toContain(path.join('.tutordesk', 'trash', 'students'));
    expect(await readFile(path.join(dest, 'profile.json'), 'utf8')).toContain('Mina Park');
    expect(await ws.listStudents()).toEqual([]);
    await expect(ws.deleteStudent('../x')).rejects.toBeInstanceOf(PathEscapeError);
  });
});
