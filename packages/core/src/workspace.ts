import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appendJsonl, readJson, readJsonl, writeFileAtomic, writeJson, type Parsed } from './fsio.js';
import { StudentGit } from './git.js';
import { withDirLock } from './lock.js';
import { resolveInside } from './paths.js';
import { renderAgentContext, renderProfileMd } from './render-md.js';
import {
  ErrorInstance,
  LessonMeta,
  NewStudentInput,
  SCORE_SCALES,
  StudentProfile,
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
    return resolveInside(this.studentsDir, id);
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

  private async uniqueId(base: string): Promise<string> {
    let id = base;
    for (let n = 2; await exists(path.join(this.studentsDir, id)); n++) id = `${base}-${n}`;
    return id;
  }

  async createStudent(input: NewStudentInput): Promise<StudentProfile> {
    const data = NewStudentInput.parse(input);
    const id = await this.uniqueId(`${slugify(data.name)}-${EXAM_SHORT[data.exam]}`);
    const ts = nowIso();
    const profile = StudentProfile.parse({
      schemaVersion: 1,
      id,
      name: data.name,
      ageOrGrade: data.ageOrGrade,
      firstLanguage: data.firstLanguage ?? 'zh',
      goal: {
        exam: data.exam,
        examDates: data.examDate ? [data.examDate] : [],
        targetOverall: data.targetOverall,
      },
      createdAt: ts,
      updatedAt: ts,
    });

    const dir = path.join(this.studentsDir, id);
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
    return out;
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
    return resolveInside(await this.studentDir(id), path.join('lessons', lessonId));
  }

  async history(id: string, limit?: number) {
    return new StudentGit(await this.studentDir(id)).log(limit);
  }

  scaleFor(profile: StudentProfile) {
    return SCORE_SCALES[profile.goal.exam];
  }
}
