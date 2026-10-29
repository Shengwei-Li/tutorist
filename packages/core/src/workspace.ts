import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { z } from 'zod';
import path from 'node:path';
import { appendJsonl, readJson, readJsonl, writeFileAtomic, writeJson, type Parsed } from './fsio.js';
import { StudentGit } from './git.js';
import { withDirLock } from './lock.js';
import { PathEscapeError, resolveInside } from './paths.js';
import { renderAgentContext, renderProfileMd } from './render-md.js';
import {
  ErrorInstance,
  LessonMeta,
  NewStudentInput,
  SCORE_SCALES,
  StudentProfile,
  SubmissionMeta,
  WorkspaceManifest,
} from './schemas.js';

export const TEMPLATE_VERSION = '0.1.0';

const STUDENT_DIRS = ['materials/raw', 'materials/parsed', 'lessons', 'submissions', 'plan'] as const;

export type StudentEntry =
  | { ok: true; profile: StudentProfile; dir: string }
  | { ok: false; id: string; dir: string; issues: string[] };

function nowIso(): string {
  return new Date().toISOString();
}

/** A student, lesson or submission id names one folder: never a path, `.` or `..`. */
function oneFolder(id: string, what: string): string {
  if (typeof id !== 'string' || !id || id === '.' || id === '..' || /[\\/]/.test(id)) throw new PathEscapeError(String(id).slice(0, 80), `${what} folders`);
  return id;
}

function slugify(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii.slice(0, 40) || 'student';
}

const EXAM_SHORT: Record<StudentProfile['goal']['exam'], string> = {
  'ielts-academic': 'ielts',
  'ielts-general': 'ielts-gt',
  'pte-academic': 'pte',
  'pte-core': 'pte-core',
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * File-backed teacher workspace (SPEC §3). Files are the source of truth; any index is derived.
 * Layout: <root>/workspace.json, .claude/, templates/, library/, brand/, students/<id>/...
 */
export class WorkspaceService {
  readonly studentsDir: string;

  constructor(readonly root: string) {
    this.studentsDir = path.join(root, 'students');
  }

  /** Create (or adopt) a workspace. Template files are copied only where missing, never overwritten. */
  static async init(root: string, templateDir?: string): Promise<WorkspaceService> {
    await mkdir(root, { recursive: true });
    for (const d of ['students', 'library/raw', 'library/parsed', 'brand', 'templates']) {
      await mkdir(path.join(root, d), { recursive: true });
    }
    if (templateDir && (await exists(templateDir))) {
      await cp(templateDir, root, { recursive: true, force: false, errorOnExist: false });
      // LaTeX classes, themes and fonts are app-owned: refresh them so fixes reach existing workspaces.
      const tex = path.join(templateDir, 'templates', 'tex');
      if (await exists(tex)) await cp(tex, path.join(root, 'templates', 'tex'), { recursive: true, force: true });
    }
    const manifestFile = path.join(root, 'workspace.json');
    if (!(await exists(manifestFile))) {
      const manifest: WorkspaceManifest = {
        schemaVersion: 1,
        createdAt: nowIso(),
        templateVersion: TEMPLATE_VERSION,
      };
      await writeJson(manifestFile, manifest);
    }
    return new WorkspaceService(root);
  }

  async manifest(): Promise<Parsed<WorkspaceManifest>> {
    return readJson(path.join(this.root, 'workspace.json'), WorkspaceManifest);
  }

  async studentDir(id: string): Promise<string> {
    return resolveInside(this.studentsDir, oneFolder(id, 'student'));
  }

  async listStudents(): Promise<StudentEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.studentsDir);
    } catch {
      return [];
    }
    const out: StudentEntry[] = [];
    for (const id of names.sort()) {
      const dir = path.join(this.studentsDir, id);
      if (!(await stat(dir)).isDirectory()) continue;
      const r = await readJson(path.join(dir, 'profile.json'), StudentProfile);
      out.push(r.ok ? { ok: true, profile: r.value, dir } : { ok: false, id, dir, issues: r.issues });
    }
    return out;
  }

  /** Claim a free folder name: creating the folder is the claim, so two students made at once never share one. */
  private async reserveId(base: string): Promise<string> {
    await mkdir(this.studentsDir, { recursive: true });
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      try {
        await mkdir(path.join(this.studentsDir, id));
        return id;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
  }

  async createStudent(input: NewStudentInput): Promise<StudentProfile> {
    const data = NewStudentInput.parse(input);
    const id = await this.reserveId(`${slugify(data.name)}-${EXAM_SHORT[data.exam]}`);
    const ts = nowIso();
    const parsed = StudentProfile.safeParse({
      schemaVersion: 1,
      id,
      name: data.name,
      ageOrGrade: data.ageOrGrade,
      firstLanguage: data.firstLanguage ?? 'zh',
      delivery: data.delivery ? { ...data.delivery, format: 'one-to-one' } : undefined,
      goal: {
        exam: data.exam,
        examDates: data.examDate ? [data.examDate] : [],
        targetOverall: data.targetOverall,
      },
      createdAt: ts,
      updatedAt: ts,
    });
    const dir = path.join(this.studentsDir, id);
    if (!parsed.success) {
      await rm(dir, { recursive: true, force: true });
      throw parsed.error;
    }
    const profile = parsed.data;

    for (const d of STUDENT_DIRS) await mkdir(path.join(dir, d), { recursive: true });
    await this.writeProfileFiles(dir, profile);
    await writeFile(path.join(dir, 'notes.md'), `# Notes on ${profile.name}\n\n`, 'utf8');
    await writeFile(path.join(dir, 'progress.md'), `# Progress\n\n`, 'utf8');
    await writeFile(path.join(dir, 'error-log.jsonl'), '', 'utf8');
    await writeFile(path.join(dir, '.gitignore'), '.tutordesk.lock\n*.tmp\nlessons/**/build/\n', 'utf8');

    const git = new StudentGit(dir);
    if (await git.init()) await git.commitAll(`Create student ${profile.name}`);
    return profile;
  }

  private async writeProfileFiles(dir: string, profile: StudentProfile): Promise<void> {
    await writeJson(path.join(dir, 'profile.json'), profile);
    await writeFileAtomic(path.join(dir, 'profile.md'), renderProfileMd(profile));
    const ctx = renderAgentContext(profile);
    await writeFileAtomic(path.join(dir, 'CLAUDE.md'), ctx);
    await writeFileAtomic(path.join(dir, 'AGENTS.md'), ctx);
  }

  async readProfile(id: string): Promise<Parsed<StudentProfile>> {
    return readJson(path.join(await this.studentDir(id), 'profile.json'), StudentProfile);
  }

  /** Apply a change to the profile; the result is re-validated before anything is written. */
  async updateProfile(id: string, change: (p: StudentProfile) => StudentProfile, message?: string): Promise<StudentProfile> {
    const dir = await this.studentDir(id);
    return withDirLock(dir, 'update profile', async () => {
      const cur = await readJson(path.join(dir, 'profile.json'), StudentProfile);
      if (!cur.ok) throw new Error(`profile.json is invalid: ${cur.issues.join('; ')}`);
      const next = StudentProfile.parse({ ...change(structuredClone(cur.value)), id, updatedAt: nowIso() });
      await this.writeProfileFiles(dir, next);
      await new StudentGit(dir).commitAll(message ?? 'Update profile');
      return next;
    });
  }

  /**
   * Remove a student from the workspace. Nothing is destroyed: the folder (with its own git history)
   * moves to .tutordesk/trash, where it can be moved back by hand.
   */
  async deleteStudent(id: string): Promise<string> {
    const dir = await this.studentDir(id);
    if (!(await exists(path.join(dir, 'profile.json')))) throw new Error(`No student ${id}`);
    const stamp = nowIso().replace(/[:.]/g, '-');
    const dest = path.join(this.root, '.tutordesk', 'trash', 'students', `${id}-${stamp}`);
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(dir, dest);
    return dest;
  }

  /** Rewrite the error log: `change` returns the new entry, or null to remove it. Unparseable lines are kept. */
  async updateErrors(id: string, change: (e: ErrorInstance) => ErrorInstance | null, message: string): Promise<void> {
    const dir = await this.studentDir(id);
    const file = path.join(dir, 'error-log.jsonl');
    await withDirLock(dir, 'update error log', async () => {
      const raw = await readFile(file, 'utf8').catch(() => '');
      const out: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let parsed: ErrorInstance | null = null;
        try {
          const r = ErrorInstance.safeParse(JSON.parse(line));
          if (r.success) parsed = r.data;
        } catch {
          // keep the line as it is
        }
        if (!parsed) {
          out.push(line);
          continue;
        }
        const next = change(parsed);
        if (next) out.push(JSON.stringify(ErrorInstance.parse(next)));
      }
      await writeFileAtomic(file, out.length ? `${out.join('\n')}\n` : '');
      await new StudentGit(dir).commitAll(message);
    });
  }

  async appendError(id: string, err: ErrorInstance): Promise<void> {
    const value = ErrorInstance.parse(err);
    await appendJsonl(path.join(await this.studentDir(id), 'error-log.jsonl'), value);
  }

  async readErrors(id: string) {
    return readJsonl(path.join(await this.studentDir(id), 'error-log.jsonl'), ErrorInstance);
  }

  async listLessons(id: string): Promise<LessonMeta[]> {
    const lessonsDir = path.join(await this.studentDir(id), 'lessons');
    let names: string[] = [];
    try {
      names = await readdir(lessonsDir);
    } catch {
      return [];
    }
    const out: LessonMeta[] = [];
    for (const n of names.sort()) {
      const r = await readJson(path.join(lessonsDir, n, 'lesson.json'), LessonMeta);
      if (r.ok) out.push(r.value);
    }
    // By the date the lesson takes place (it can be moved), then by its number.
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
  }

  async createLesson(id: string, opts: { date: string; minutes?: number; topic?: string }): Promise<LessonMeta> {
    const dir = await this.studentDir(id);
    const profile = await this.readProfile(id);
    if (!profile.ok) throw new Error(`profile.json is invalid: ${profile.issues.join('; ')}`);
    return withDirLock(dir, 'create lesson', async () => {
      const existing = await this.listLessons(id);
      const number = existing.reduce((m, l) => Math.max(m, l.number), 0) + 1;
      const lessonId = `${opts.date}-L${String(number).padStart(2, '0')}`;
      const meta = LessonMeta.parse({
        schemaVersion: 1,
        id: lessonId,
        studentId: id,
        number,
        date: opts.date,
        minutes: opts.minutes ?? profile.value.delivery.minutesPerSession,
        topic: opts.topic ?? '',
        status: 'planned',
        createdAt: nowIso(),
      });
      await writeJson(path.join(dir, 'lessons', lessonId, 'lesson.json'), meta);
      await new StudentGit(dir).commitAll(`Create lesson ${lessonId}`);
      return meta;
    });
  }

  async lessonDir(id: string, lessonId: string): Promise<string> {
    return resolveInside(await this.studentDir(id), path.join('lessons', oneFolder(lessonId, 'lesson')));
  }

  async readLesson(id: string, lessonId: string): Promise<LessonMeta> {
    const r = await readJson(path.join(await this.lessonDir(id, lessonId), 'lesson.json'), LessonMeta);
    if (!r.ok) throw new Error(`lesson.json is invalid: ${r.issues.join('; ')}`);
    return r.value;
  }

  async updateLesson(id: string, lessonId: string, change: (l: LessonMeta) => LessonMeta, message?: string): Promise<LessonMeta> {
    const dir = await this.lessonDir(id, lessonId);
    const next = LessonMeta.parse(change(await this.readLesson(id, lessonId)));
    await writeJson(path.join(dir, 'lesson.json'), next);
    if (message) await this.commit(id, message);
    return next;
  }

  /** Remove a lesson and everything prepared for it. The student's git history keeps a copy. */
  async deleteLesson(id: string, lessonId: string): Promise<void> {
    const dir = await this.lessonDir(id, lessonId);
    await this.readLesson(id, lessonId);
    await rm(dir, { recursive: true, force: true });
    await this.commit(id, `Delete lesson ${lessonId}`);
  }

  /** Read a JSON file inside a lesson folder, validated; null when it does not exist yet. */
  async readLessonJson<S extends z.ZodType>(id: string, lessonId: string, file: string, schema: S): Promise<z.infer<S> | null> {
    const abs = await resolveInside(await this.lessonDir(id, lessonId), file);
    if (!(await exists(abs))) return null;
    const r = await readJson(abs, schema);
    if (!r.ok) throw new Error(`${file} is invalid: ${r.issues.join('; ')}`);
    return r.value;
  }

  async writeLessonFile(id: string, lessonId: string, file: string, content: string | Buffer | object): Promise<string> {
    const abs = await resolveInside(await this.lessonDir(id, lessonId), file);
    if (Buffer.isBuffer(content)) {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    } else if (typeof content === 'string') await writeFileAtomic(abs, content);
    else await writeJson(abs, content);
    return abs;
  }

  async appendRunLog(id: string, lessonId: string, entry: object): Promise<void> {
    await appendJsonl(path.join(await this.lessonDir(id, lessonId), 'run-log.jsonl'), { at: nowIso(), ...entry });
  }

  async commit(id: string, message: string): Promise<string | null> {
    return new StudentGit(await this.studentDir(id)).commitAll(message);
  }

  /* ── submissions (essays) ── */

  async createSubmission(
    id: string,
    input: { kind: SubmissionMeta['kind']; prompt?: string; text?: string; image?: { name: string; data: Buffer }; date: string },
  ): Promise<SubmissionMeta> {
    const dir = await this.studentDir(id);
    const base = `${input.date}-${input.kind === 'writing-task1' ? 'task1' : 'task2'}`;
    let subId = base;
    for (let n = 2; await exists(path.join(dir, 'submissions', subId)); n++) subId = `${base}-${n}`;
    const subDir = path.join(dir, 'submissions', subId);
    await mkdir(subDir, { recursive: true });
    let original: string | undefined;
    if (input.image) {
      original = `original${path.extname(input.image.name).toLowerCase() || '.png'}`;
      await writeFile(path.join(subDir, original), input.image.data);
    }
    const meta = SubmissionMeta.parse({
      schemaVersion: 1,
      id: subId,
      kind: input.kind,
      prompt: input.prompt ?? '',
      source: input.image ? 'image' : 'text',
      original,
      textConfirmed: !input.image,
      createdAt: nowIso(),
    });
    await writeJson(path.join(subDir, 'meta.json'), meta);
    await writeFileAtomic(path.join(subDir, 'text.md'), input.text ?? '');
    await this.commit(id, `Add submission ${subId}`);
    return meta;
  }

  async submissionDir(id: string, subId: string): Promise<string> {
    return resolveInside(await this.studentDir(id), path.join('submissions', oneFolder(subId, 'submission')));
  }

  async listSubmissions(id: string): Promise<SubmissionMeta[]> {
    const root = path.join(await this.studentDir(id), 'submissions');
    const names = await readdir(root).catch(() => [] as string[]);
    const out: SubmissionMeta[] = [];
    for (const n of names.sort().reverse()) {
      const r = await readJson(path.join(root, n, 'meta.json'), SubmissionMeta);
      if (r.ok) out.push(r.value);
    }
    return out;
  }

  async readSubmission(id: string, subId: string): Promise<{ meta: SubmissionMeta; text: string; dir: string }> {
    const dir = await this.submissionDir(id, subId);
    const r = await readJson(path.join(dir, 'meta.json'), SubmissionMeta);
    if (!r.ok) throw new Error(`meta.json is invalid: ${r.issues.join('; ')}`);
    const text = await readFile(path.join(dir, 'text.md'), 'utf8').catch(() => '');
    return { meta: r.value, text, dir };
  }

  async updateSubmission(id: string, subId: string, change: { meta?: (m: SubmissionMeta) => SubmissionMeta; text?: string }, message?: string): Promise<SubmissionMeta> {
    const { meta, dir } = await this.readSubmission(id, subId);
    const next = SubmissionMeta.parse(change.meta ? change.meta(meta) : meta);
    await writeJson(path.join(dir, 'meta.json'), next);
    if (change.text !== undefined) await writeFileAtomic(path.join(dir, 'text.md'), change.text);
    if (message) await this.commit(id, message);
    return next;
  }

  /** Remove an essay and its review. The student's git history keeps a copy. */
  async deleteSubmission(id: string, subId: string): Promise<void> {
    const { dir } = await this.readSubmission(id, subId);
    await rm(dir, { recursive: true, force: true });
    await this.commit(id, `Delete submission ${subId}`);
  }

  async history(id: string, limit?: number) {
    return new StudentGit(await this.studentDir(id)).log(limit);
  }

  scaleFor(profile: StudentProfile) {
    return SCORE_SCALES[profile.goal.exam];
  }
}
