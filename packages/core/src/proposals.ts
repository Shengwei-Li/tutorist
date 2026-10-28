import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { readJson, writeJson } from './fsio.js';
import { withDirLock } from './lock.js';
import { ProfileChanges, Proposal, ProposedLesson, ProposedStudent, draftProfile, mergeProfile, type LessonMeta, type NewProposal, type ProposalEdit } from './schemas.js';
import type { WorkspaceService } from './workspace.js';

/** Storing and applying proposals (the schemas are in schemas.ts, shared with the renderer). */
const ID = /^[\w-]{1,80}$/;

/** Proposals live in <workspace>/.tutordesk/proposals, one JSON file each. */
export class ProposalStore {
  readonly dir: string;

  constructor(root: string) {
    this.dir = path.join(root, '.tutordesk', 'proposals');
  }

  private file(id: string): string {
    if (!ID.test(id)) throw new Error(`Invalid proposal id ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  /**
   * Save a proposal. An earlier pending proposal about the same thing (same student and kind, or a
   * new student of the same name) is superseded: the tutor only ever sees the latest one.
   */
  async create(input: NewProposal): Promise<Proposal> {
    await mkdir(this.dir, { recursive: true });
    return withDirLock(this.dir, 'save proposal', async () => {
      const same = (p: Proposal) =>
        p.kind === input.kind &&
        (p.kind === 'student' && input.kind === 'student' ? p.student.name.trim().toLowerCase() === input.student.name.trim().toLowerCase() : 'studentId' in p && 'studentId' in input && p.studentId === input.studentId);
      for (const p of await this.list({ status: 'pending' })) if (same(p)) await writeJson(this.file(p.id), { ...p, status: 'dismissed' });
      const proposal = Proposal.parse({ ...input, schemaVersion: 1, id: `${Date.now()}-${randomUUID().slice(0, 8)}`, status: 'pending', createdAt: new Date().toISOString() });
      await writeJson(this.file(proposal.id), proposal);
      return proposal;
    });
  }

  async get(id: string): Promise<Proposal | null> {
    const r = await readJson(this.file(id), Proposal);
    return r.ok ? r.value : null;
  }

  /** Oldest first. Unreadable files are skipped. */
  async list(filter: { studentId?: string; kind?: Proposal['kind']; status?: Proposal['status'] } = {}): Promise<Proposal[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const out: Proposal[] = [];
    for (const n of names.filter((x) => x.endsWith('.json')).sort()) {
      const r = await readJson(path.join(this.dir, n), Proposal);
      if (!r.ok) continue;
      const p = r.value;
      if (filter.kind && p.kind !== filter.kind) continue;
      if (filter.status && p.status !== filter.status) continue;
      if (filter.studentId && !('studentId' in p && p.studentId === filter.studentId)) continue;
      out.push(p);
    }
    return out;
  }

  async setStatus(id: string, status: 'applied' | 'dismissed', extra: { appliedStudentId?: string } = {}): Promise<Proposal> {
    const p = await this.get(id);
    if (!p) throw new Error('This proposal no longer exists.');
    const next = Proposal.parse({ ...p, ...extra, status });
    await writeJson(this.file(id), next);
    return next;
  }
}

export interface AppliedProposal {
  studentId: string;
  lessons: LessonMeta[];
}

/** Apply a pending proposal (with the tutor's edits) to the workspace, then mark it applied. */
export async function applyProposal(ws: WorkspaceService, store: ProposalStore, id: string, edit: ProposalEdit = {}): Promise<AppliedProposal> {
  const p = await store.get(id);
  if (!p) throw new Error('This proposal no longer exists.');
  if (p.status !== 'pending') throw new Error(`This proposal was already ${p.status}.`);
  const by = p.by ? ` (${p.by})` : '';
  const lessons = z.array(ProposedLesson).max(30).parse(edit.lessons ?? ('lessons' in p ? p.lessons : []));

  let studentId: string;
  if (p.kind === 'student') {
    const s = ProposedStudent.parse(edit.student ?? p.student);
    const full = draftProfile(s); // throws before anything is written
    const created = await ws.createStudent({ name: s.name, exam: s.exam, targetOverall: s.targetOverall, examDate: s.examDate, ageOrGrade: s.ageOrGrade, firstLanguage: s.firstLanguage, delivery: { mode: full.delivery.mode, sessionsPerWeek: full.delivery.sessionsPerWeek, minutesPerSession: full.delivery.minutesPerSession } });
    studentId = created.id;
    await ws.updateProfile(studentId, (cur) => ({ ...full, id: cur.id, createdAt: cur.createdAt, updatedAt: cur.updatedAt }), `Update profile${by}`);
  } else {
    studentId = p.studentId;
    if (p.kind === 'profile') {
      const changes = ProfileChanges.parse(edit.changes ?? p.changes);
      await ws.updateProfile(studentId, (cur) => mergeProfile(cur, changes), `Update profile${by}`);
    }
  }

  const made: LessonMeta[] = [];
  for (const l of [...lessons].sort((a, b) => a.date.localeCompare(b.date))) {
    const meta = await ws.createLesson(studentId, { date: l.date, minutes: l.minutes, topic: l.topic });
    made.push(l.brief ? await ws.updateLesson(studentId, meta.id, (m) => ({ ...m, brief: l.brief! }), `Brief for ${meta.id}`) : meta);
  }
  await store.setStatus(id, 'applied', p.kind === 'student' ? { appliedStudentId: studentId } : {});
  return { studentId, lessons: made };
}
