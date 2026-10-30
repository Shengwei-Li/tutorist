import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { readJson, writeJson } from '@tutordesk/core';

/**
 * Thread index (appendix E.3.3). Each harness keeps the full conversation itself; TutorDesk stores
 * what the thread is about, which native session continues it, and a short log for the UI.
 */
export const ThreadSubject = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace') }),
  z.object({ type: z.literal('student'), studentId: z.string() }),
  z.object({ type: z.literal('lesson'), studentId: z.string(), lessonId: z.string() }),
  z.object({ type: z.literal('submission'), studentId: z.string(), submissionId: z.string() }),
]);
export type ThreadSubject = z.infer<typeof ThreadSubject>;

export const ThreadEntry = z.discriminatedUnion('role', [
  z.object({ role: z.literal('tutor'), text: z.string(), at: z.string() }),
  z.object({ role: z.literal('agent'), text: z.string(), at: z.string(), by: z.string().optional() }),
  z.object({ role: z.literal('tool'), name: z.string(), ok: z.boolean(), summary: z.string().optional(), target: z.string().optional(), at: z.string() }),
  z.object({ role: z.literal('system'), text: z.string(), at: z.string() }),
]);
export type ThreadEntry = z.infer<typeof ThreadEntry>;

export const ThreadRecord = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  title: z.string(),
  subject: ThreadSubject,
  harness: z.enum(['claude-code', 'codex', 'opencode', 'api']),
  mode: z.enum(['guarded', 'collaborate', 'full']),
  /** Native session per harness: switching harness starts a new one and keeps the old to switch back. */
  sessions: z.record(z.string(), z.string()).default({}),
  /** The model chosen per harness (ids differ between agents); absent means the default from Settings. */
  models: z.record(z.string(), z.string()).default({}),
  entries: z.array(ThreadEntry).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ThreadRecord = z.infer<typeof ThreadRecord>;

const MAX_ENTRIES = 400;

/** The last pending write per thread file. */
const WRITES = new Map<string, Promise<void>>();

export class ThreadStore {
  private readonly dir: string;

  constructor(workspaceRoot: string) {
    this.dir = path.join(workspaceRoot, '.tutordesk', 'threads');
  }

  private file(id: string): string {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Bad thread id ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async create(o: Pick<ThreadRecord, 'title' | 'subject' | 'harness' | 'mode'>): Promise<ThreadRecord> {
    const now = new Date().toISOString();
    const t: ThreadRecord = { schemaVersion: 1, id: randomUUID(), sessions: {}, models: {}, entries: [], createdAt: now, updatedAt: now, ...o };
    await mkdir(this.dir, { recursive: true });
    await writeJson(this.file(t.id), t);
    return t;
  }

  async get(id: string): Promise<ThreadRecord | null> {
    const r = await readJson(this.file(id), ThreadRecord);
    return r.ok ? r.value : null;
  }

  async list(filter?: Partial<{ studentId: string; lessonId: string }>): Promise<ThreadRecord[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const out: ThreadRecord[] = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const r = await readJson(path.join(this.dir, n), ThreadRecord);
      if (!r.ok) continue;
      const s = r.value.subject;
      if (filter?.studentId && !('studentId' in s && s.studentId === filter.studentId)) continue;
      if (filter?.lessonId && !(s.type === 'lesson' && s.lessonId === filter.lessonId)) continue;
      out.push(r.value);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Read-modify-write, one at a time per thread file (across store instances), so no change is lost. */
  update(id: string, change: (t: ThreadRecord) => ThreadRecord): Promise<ThreadRecord> {
    const file = this.file(id);
    const run = async () => {
      const t = await this.get(id);
      if (!t) throw new Error(`No thread ${id}`);
      const next = ThreadRecord.parse({ ...change(t), updatedAt: new Date().toISOString() });
      next.entries = next.entries.slice(-MAX_ENTRIES);
      await writeJson(file, next);
      return next;
    };
    const result = (WRITES.get(file) ?? Promise.resolve()).then(run, run);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    WRITES.set(file, tail);
    void tail.then(() => {
      if (WRITES.get(file) === tail) WRITES.delete(file);
    });
    return result;
  }

  append(id: string, ...entries: ThreadEntry[]): Promise<ThreadRecord> {
    return this.update(id, (t) => ({ ...t, entries: [...t.entries, ...entries] }));
  }
}

/** What a thread adds to the agent's instructions: which student, lesson or essay it is about. */
export function subjectInstructions(subject: ThreadSubject, names: { student?: string } = {}): string {
  const who = 'studentId' in subject ? `${names.student ?? subject.studentId} (studentId "${subject.studentId}")` : '';
  switch (subject.type) {
    case 'workspace':
      return 'You are working in a TutorDesk workspace. Follow AGENTS.md.';
    case 'student':
      return `You are working in a TutorDesk workspace on student ${who}. Follow AGENTS.md.`;
    case 'lesson':
      return `You are working in a TutorDesk workspace on lesson "${subject.lessonId}" of student ${who}. Follow AGENTS.md and the tutordesk-lesson-prep skill.`;
    case 'submission':
      return `You are working in a TutorDesk workspace on essay "${subject.submissionId}" of student ${who}. Follow AGENTS.md and the tutordesk-writing-review skill.`;
  }
}
