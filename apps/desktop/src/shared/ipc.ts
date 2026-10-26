/**
 * Contract between the renderer and the main process. The renderer never touches the file system
 * or spawns processes; everything goes through these calls (contextIsolation + sandbox).
 */
import type { ErrorInstance, LessonMeta, NewStudentInput, StudentProfile } from '@tutordesk/core/schemas';
import type { AgentEvent, HealthStatus } from '@tutordesk/providers/types';

export type Lang = 'en' | 'zh';

export interface AppSettings {
  workspaceRoot: string;
  language: Lang;
  /** Optional user-configured TeX bin directory. */
  texBinDir?: string;
  beamerTheme: BeamerTheme;
}

export const BEAMER_THEMES = ['tutorswiss', 'tutorbook', 'tutorsheet', 'tutorfocus'] as const;
export type BeamerTheme = (typeof BEAMER_THEMES)[number];

export type StudentSummary =
  | { ok: true; profile: StudentProfile }
  | { ok: false; id: string; issues: string[] };

export interface StudentDetail {
  profile: StudentProfile;
  lessons: LessonMeta[];
  errors: ErrorInstance[];
  history: { hash: string; date: string; message: string }[];
  dir: string;
}

export interface TexStatus {
  found: boolean;
  kind?: string;
  version?: string;
  binDir?: string;
  hasLatexmk?: boolean;
  missingFiles: string[];
}

export type SampleDoc = 'handout' | 'worksheet' | 'script' | 'deck';

export interface CompileSampleRequest {
  doc: SampleDoc;
  mode: 'student' | 'teacher' | 'key';
  theme: BeamerTheme;
}

export interface CompileOutcome {
  ok: boolean;
  pdf?: Uint8Array;
  durationMs: number;
  errors: { severity: string; message: string; line?: number }[];
  engine: string;
}

export interface TestRunResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  issues?: string[];
  attempts: number;
  usd: number;
}

export interface DesktopApi {
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    chooseWorkspace(): Promise<AppSettings | null>;
  };
  students: {
    list(): Promise<StudentSummary[]>;
    create(input: NewStudentInput): Promise<StudentProfile>;
    get(id: string): Promise<StudentDetail>;
    createLesson(id: string, opts: { date: string; topic?: string; minutes?: number }): Promise<LessonMeta>;
    reveal(id: string): Promise<void>;
  };
  health: {
    claude(): Promise<HealthStatus>;
    tex(refresh?: boolean): Promise<TexStatus>;
  };
  tex: {
    compileSample(req: CompileSampleRequest): Promise<CompileOutcome>;
  };
  agent: {
    /** Starts a small structured test task; events arrive through onEvent with the returned run id. */
    testRun(): Promise<string>;
    cancel(runId: string): Promise<void>;
    onEvent(cb: (runId: string, ev: AgentEvent | { type: 'finished'; result: TestRunResult }) => void): () => void;
  };
}
