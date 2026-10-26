/**
 * Contract between the renderer and the main process. The renderer never touches the file system,
 * holds API keys or spawns processes; everything goes through these calls (contextIsolation + sandbox).
 */
import type { ArtifactDoc, ArtifactKind, LessonPlan, QaCheck, RubricReview, WritingReview } from '@tutordesk/core/artifacts';
import type { ErrorInstance, LessonMeta, NewStudentInput, StudentProfile, SubmissionMeta } from '@tutordesk/core/schemas';
import type { AgentEvent, HealthStatus, ModelTier } from '@tutordesk/providers/types';

export type Lang = 'en' | 'zh';

export const BEAMER_THEMES = ['tutorswiss', 'tutorbook', 'tutorsheet', 'tutorfocus'] as const;
export type BeamerTheme = (typeof BEAMER_THEMES)[number];

export const API_GATEWAYS = ['openrouter', 'anthropic', 'openai', 'openai-compatible'] as const;
export type ApiGateway = (typeof API_GATEWAYS)[number];

export interface AppSettings {
  workspaceRoot: string;
  language: Lang;
  texBinDir?: string;
  beamerTheme: BeamerTheme;
  /** Mode A (local CLI on the user's subscription) or mode B (API key) — SPEC §7.2. */
  aiBackend: 'claude-cli' | 'api';
  api: { gateway: ApiGateway; baseURL?: string; models: Record<ModelTier, string> };
  studio: { name: string; monogram: string };
  tutorName: string;
}

export type StudentSummary = { ok: true; profile: StudentProfile } | { ok: false; id: string; issues: string[] };

export interface StudentDetail {
  profile: StudentProfile;
  lessons: LessonMeta[];
  errors: ErrorInstance[];
  submissions: SubmissionMeta[];
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

export interface QaReportView {
  kind: ArtifactKind | 'plan';
  rounds: number;
  checks: QaCheck[];
  review?: RubricReview;
  passed: boolean;
  needsTutor: string[];
  usd: number;
  at: string;
}

export interface LessonDetail {
  lesson: LessonMeta;
  plan: LessonPlan | null;
  docs: Partial<Record<ArtifactKind, ArtifactDoc>>;
  qa: Partial<Record<ArtifactKind | 'plan', QaReportView>>;
}

export type EditionMode = 'student' | 'teacher' | 'key';

export interface CompileOutcome {
  ok: boolean;
  pdf?: Uint8Array;
  durationMs: number;
  errors: { severity: string; message: string; line?: number; nodeId?: string }[];
  engine?: string;
}

export type SampleDoc = 'handout' | 'worksheet' | 'script' | 'deck';
export interface CompileSampleRequest {
  doc: SampleDoc;
  mode: EditionMode;
  theme: BeamerTheme;
}

/** Long-running AI work streams these to the renderer under a run id. */
export type RunEvent =
  | { type: 'step'; step: string; kind?: string; status: 'start' | 'done' | 'fail'; message?: string; round?: number }
  | { type: 'agent'; kind?: string; event: AgentEvent }
  | { type: 'finished'; ok: boolean; error?: string; result?: unknown };

export interface AnchoredAnnotationView {
  index: number;
  quote: string;
  kind: 'grammar' | 'lexis' | 'cohesion' | 'task';
  code: string;
  explanation: string;
  suggestion: string;
  start: number | null;
  end: number | null;
}

export interface StoredReviewView {
  review: WritingReview;
  annotations: AnchoredAnnotationView[];
  wordCount: number;
  issues: string[];
  usd: number;
  at: string;
}

export interface SubmissionDetail {
  meta: SubmissionMeta;
  text: string;
  review: StoredReviewView | null;
  /** data: URL of the original photo, if any. */
  image?: string;
}

export interface DesktopApi {
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    chooseWorkspace(): Promise<AppSettings | null>;
    /** Stores the key encrypted with the OS keychain; the renderer never reads it back. */
    setApiKey(key: string): Promise<{ stored: boolean; encrypted: boolean }>;
    hasApiKey(): Promise<boolean>;
    defaultModels(gateway: ApiGateway): Promise<Record<ModelTier, string>>;
  };
  students: {
    list(): Promise<StudentSummary[]>;
    create(input: NewStudentInput): Promise<StudentProfile>;
    get(id: string): Promise<StudentDetail>;
    createLesson(id: string, opts: { date: string; topic?: string; minutes?: number }): Promise<LessonMeta>;
    reveal(id: string): Promise<void>;
  };
  lessons: {
    get(studentId: string, lessonId: string): Promise<LessonDetail>;
    setBrief(studentId: string, lessonId: string, brief: string): Promise<LessonMeta>;
    attachMaterial(studentId: string, lessonId: string): Promise<LessonMeta | null>;
    plan(studentId: string, lessonId: string, opts: { brief?: string; outputs: ArtifactKind[] }): Promise<string>;
    confirmPlan(studentId: string, lessonId: string, plan: LessonPlan): Promise<void>;
    generate(studentId: string, lessonId: string, kinds: ArtifactKind[]): Promise<string>;
    revise(studentId: string, lessonId: string, kind: ArtifactKind, instruction: string): Promise<string>;
    exportPdf(studentId: string, lessonId: string, kind: ArtifactKind, mode: EditionMode, theme?: BeamerTheme): Promise<CompileOutcome>;
    revealOutput(studentId: string, lessonId: string): Promise<void>;
  };
  submissions: {
    createText(studentId: string, input: { kind: SubmissionMeta['kind']; prompt: string; text: string }): Promise<SubmissionMeta>;
    createFromImage(studentId: string, kind: SubmissionMeta['kind']): Promise<SubmissionMeta | null>;
    get(studentId: string, subId: string): Promise<SubmissionDetail>;
    confirmText(studentId: string, subId: string, text: string, prompt: string): Promise<void>;
    transcribe(studentId: string, subId: string): Promise<string>;
    review(studentId: string, subId: string): Promise<string>;
    finalise(studentId: string, subId: string, finalBands: Record<string, number>, accepted: number[]): Promise<void>;
  };
  runs: {
    cancel(runId: string): Promise<void>;
    onEvent(cb: (runId: string, ev: RunEvent) => void): () => void;
  };
  health: {
    ai(): Promise<HealthStatus & { backend: AppSettings['aiBackend'] }>;
    tex(refresh?: boolean): Promise<TexStatus>;
  };
  tex: {
    compileSample(req: CompileSampleRequest): Promise<CompileOutcome>;
  };
}
