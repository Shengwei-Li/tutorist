/**
 * Contract between the renderer and the main process. The renderer never touches the file system,
 * holds API keys or spawns processes; everything goes through these calls (contextIsolation + sandbox).
 */
import type { ArtifactDoc, ArtifactKind, LessonPlan, QaCheck, RubricReview, WritingReview } from '@tutordesk/core/artifacts';
import type { ErrorInstance, LessonMeta, NewStudentInput, Proposal, ProposalEdit, StudentProfile, SubmissionMeta } from '@tutordesk/core/schemas';
import type { AgentEvent, HealthStatus, ModelTier } from '@tutordesk/providers/types';

export type Lang = 'en' | 'zh';

export const BEAMER_THEMES = ['tutorswiss', 'tutorbook', 'tutorsheet', 'tutorfocus'] as const;
export type BeamerTheme = (typeof BEAMER_THEMES)[number];

export const API_GATEWAYS = ['openrouter', 'anthropic', 'openai', 'openai-compatible'] as const;
export type ApiGateway = (typeof API_GATEWAYS)[number];

/** Who does the work in a thread (appendix E): a local coding agent, or TutorDesk's own loop over an API key. */
export const AGENTS = ['claude-code', 'codex', 'opencode', 'api'] as const;
export type AgentId = (typeof AGENTS)[number];
export type AgentMode = 'guarded' | 'collaborate' | 'full';

export interface AppSettings {
  workspaceRoot: string;
  language: Lang;
  texBinDir?: string;
  beamerTheme: BeamerTheme;
  /** Mode A (local CLI on the user's subscription) or mode B (API key) — SPEC §7.2. */
  aiBackend: 'claude-cli' | 'api';
  /** Default agent for new threads, and its permission mode. */
  agent: AgentId;
  agentMode: AgentMode;
  api: { gateway: ApiGateway; baseURL?: string; models: Record<ModelTier, string> };
  studio: { name: string; monogram: string };
  tutorName: string;
  /** Which speech voice input expects; unset follows the interface language. */
  voiceLanguage?: VoiceLanguage;
}

export type VoiceLanguage = 'english' | 'chinese';

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
  /** Who wrote this version, e.g. "claude-code" or "api:google/gemini-3.8-flash". */
  by?: string;
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

/* ───────────────── threads (appendix E.3.3) ───────────────── */

export type ThreadSubject =
  | { type: 'workspace' }
  | { type: 'student'; studentId: string }
  | { type: 'lesson'; studentId: string; lessonId: string }
  | { type: 'submission'; studentId: string; submissionId: string };

/** Mirror of HarnessEvent from @tutordesk/harness (the renderer cannot import Node packages). */
export type ThreadEvent =
  | { type: 'session'; nativeId: string; model?: string }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool'; id: string; server?: string; name: string; input?: unknown; status: 'running' | 'ok' | 'error'; summary?: string }
  | { type: 'file'; path: string; op: 'create' | 'edit' | 'delete' }
  | { type: 'approval'; requestId: string; kind: 'command' | 'edit' | 'network' | 'tool' | 'other'; title: string; detail?: string }
  | { type: 'notice'; level: 'info' | 'warning'; message: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens?: number; usd?: number }
  | { type: 'turn_end'; status: 'completed' | 'interrupted' | 'failed'; error?: string };

export type ThreadEntry =
  | { role: 'tutor'; text: string; at: string }
  | { role: 'agent'; text: string; at: string; by?: AgentId }
  | { role: 'tool'; name: string; ok: boolean; summary?: string; /** What it acted on: an artifact kind, a path, a query. */ target?: string; at: string }
  | { role: 'system'; text: string; at: string };

export interface ThreadView {
  id: string;
  subject: ThreadSubject;
  agent: AgentId;
  mode: AgentMode;
  entries: ThreadEntry[];
  /** A turn is in progress (e.g. after reopening the page mid-turn). */
  running: boolean;
  /** Approvals waiting for the tutor. */
  pending: Extract<ThreadEvent, { type: 'approval' }>[];
}

export interface AgentStatus {
  id: AgentId;
  label: string;
  /** Installed and signed in (or, for API, a key is stored). */
  ready: boolean;
  /** Installed, whether or not sign-in could be confirmed. */
  installed: boolean;
  version?: string;
  /** Plain-language next step when not ready. */
  detail?: string;
}

/** A folder the tutor picked for the workspace, and what switching to it would mean. */
export interface WorkspaceChoice {
  path: string;
  same: boolean;
  /** Already a TutorDesk workspace (switching opens it as it is). */
  isWorkspace: boolean;
  empty: boolean;
  /** Students in the current workspace, which a move would copy. */
  currentStudents: number;
  /** Inside the current workspace: not allowed. */
  inside: boolean;
}

/** The local speech model for voice input. */
export interface SpeechStatus {
  state: 'absent' | 'downloading' | 'ready';
  /** English (Parakeet) or Chinese and mixed speech (SenseVoice): one model each. */
  language: VoiceLanguage;
  /** Bytes downloaded so far, and the model's size. */
  done: number;
  total: number;
}

export interface AppliedProposal {
  studentId: string;
  lessons: LessonMeta[];
}

export type ProfilePatch = Partial<Pick<StudentProfile, 'name' | 'ageOrGrade' | 'firstLanguage' | 'glossLanguage' | 'interests' | 'learningStyle' | 'parent'>> & {
  delivery?: Partial<StudentProfile['delivery']>;
  goal?: Partial<StudentProfile['goal']>;
};

export interface DesktopApi {
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    pickWorkspace(): Promise<WorkspaceChoice | null>;
    /** move: copy the current workspace into the (empty) folder first; the old folder is kept. */
    switchWorkspace(path: string, move: boolean): Promise<AppSettings>;
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
    update(id: string, patch: ProfilePatch): Promise<StudentProfile>;
    setArchived(id: string, archived: boolean): Promise<StudentProfile>;
    /** Moves the student's folder to the workspace trash (.tutordesk/trash). */
    delete(id: string): Promise<void>;
  };
  errors: {
    setStatus(studentId: string, errorId: string, status: ErrorInstance['status']): Promise<void>;
    delete(studentId: string, errorId: string): Promise<void>;
  };
  lessons: {
    get(studentId: string, lessonId: string): Promise<LessonDetail>;
    setBrief(studentId: string, lessonId: string, brief: string): Promise<LessonMeta>;
    update(studentId: string, lessonId: string, patch: Partial<Pick<LessonMeta, 'date' | 'minutes' | 'topic' | 'status'>>): Promise<LessonMeta>;
    delete(studentId: string, lessonId: string): Promise<void>;
    attachMaterial(studentId: string, lessonId: string): Promise<LessonMeta | null>;
    plan(studentId: string, lessonId: string, opts: { brief?: string; outputs: ArtifactKind[] }): Promise<string>;
    confirmPlan(studentId: string, lessonId: string, plan: LessonPlan): Promise<void>;
    generate(studentId: string, lessonId: string, kinds: ArtifactKind[]): Promise<string>;
    revise(studentId: string, lessonId: string, kind: ArtifactKind, instruction: string): Promise<string>;
    exportPdf(studentId: string, lessonId: string, kind: ArtifactKind, mode: EditionMode, theme?: BeamerTheme): Promise<CompileOutcome>;
    revealOutput(studentId: string, lessonId: string): Promise<void>;
  };
  submissions: {
    delete(studentId: string, subId: string): Promise<void>;
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
  threads: {
    /** The newest thread about this subject, created on first use. */
    open(subject: ThreadSubject): Promise<ThreadView>;
    send(threadId: string, text: string): Promise<void>;
    respond(threadId: string, requestId: string, decision: 'allow' | 'deny'): Promise<void>;
    interrupt(threadId: string): Promise<void>;
    configure(threadId: string, patch: { agent?: AgentId; mode?: AgentMode }): Promise<ThreadView>;
    /** Copy files the tutor picks into the student's materials/raw; returns workspace-relative paths. */
    attach(studentId: string): Promise<string[]>;
    onEvent(cb: (threadId: string, ev: ThreadEvent) => void): () => void;
  };
  agents: {
    status(): Promise<AgentStatus[]>;
  };
  speech: {
    status(): Promise<SpeechStatus>;
    /** Download and verify the model (about 240 MB, once). Resolves when it is ready. */
    install(): Promise<void>;
    cancelInstall(): Promise<void>;
    uninstall(): Promise<void>;
    /** 16 kHz mono samples, at most two minutes; returns the text for the tutor to check. */
    transcribe(samples: Float32Array): Promise<string>;
    onProgress(cb: (s: SpeechStatus) => void): () => void;
  };
  proposals: {
    /** Pending proposals only, oldest first. */
    list(filter: { studentId?: string; kind?: Proposal['kind'] }): Promise<Proposal[]>;
    /** Apply with the tutor's edits; threadId lets the agent hear about it on the next message. */
    apply(id: string, edit: ProposalEdit, threadId?: string): Promise<AppliedProposal>;
    dismiss(id: string, threadId?: string): Promise<void>;
  };
  health: {
    ai(): Promise<HealthStatus & { backend: AppSettings['aiBackend'] }>;
    tex(refresh?: boolean): Promise<TexStatus>;
  };
  tex: {
    compileSample(req: CompileSampleRequest): Promise<CompileOutcome>;
  };
}
