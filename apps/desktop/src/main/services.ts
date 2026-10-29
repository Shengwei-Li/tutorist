import { randomUUID } from 'node:crypto';
import { cp, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from 'electron';
import { z } from 'zod';
import { NewStudentInput, ProfileChanges, ProposalStore, ProposedLesson, ProposedStudent, applyProposal, mergeProfile, readJson, WorkspaceService } from '@tutordesk/core';
import { LessonStatus } from '@tutordesk/core/schemas';
import { ARTIFACT_SCHEMAS, ArtifactKind, LessonPlan, type ArtifactDoc } from '@tutordesk/core/artifacts';
import { LessonPipeline, WritingReviewer, type PipelineEvent } from '@tutordesk/pipeline';
import { ApiProvider, ClaudeCliProvider, DEFAULT_MODELS, type AgentProvider } from '@tutordesk/providers';
import { TexEngine } from '@tutordesk/tex';
import { writeAgentKit } from '@tutordesk/toolbox';
import {
  BEAMER_THEMES,
  type BeamerTheme,
  type CompileOutcome,
  type CompileSampleRequest,
  type EditionMode,
  type LessonDetail,
  type RunEvent,
  type StudentDetail,
  type SubmissionDetail,
  type TexStatus,
  type WorkspaceChoice,
} from '../shared/ipc.js';
import { loadApiKey, loadSettings, saveSettings, storeApiKey } from './settings.js';
import { SettingsPatch } from './settings-patch.js';
import { SpeechService } from './asr.js';
import { texOptions } from './tex-bundle.js';
import { ThreadService } from './threads.js';

/** Bundled workspace template: repo folder in development, resources folder when packaged. */
function templateRoot(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'workspace-template') : path.resolve(app.getAppPath(), '..', '..', 'workspace-template');
}

let workspace: WorkspaceService | undefined;
/** The workspace being set up: the window asks for several things at once on start, and it is set up once. */
let opening: { root: string; ready: Promise<WorkspaceService> } | undefined;
async function ws(): Promise<WorkspaceService> {
  const { workspaceRoot } = await loadSettings();
  if (workspace?.root === workspaceRoot) return workspace;
  if (opening?.root !== workspaceRoot) {
    const ready = (async () => {
      const w = await WorkspaceService.init(workspaceRoot, templateRoot());
      // Agents read AGENTS.md and skills; the tutordesk MCP server reads toolbox.json (appendix E.4.3, E.7).
      await writeAgentKit(w.root);
      await writeToolboxConfig(w.root);
      return w;
    })();
    opening = { root: workspaceRoot, ready };
    ready.then(
      (w) => {
        if (opening?.ready === ready) [workspace, opening] = [w, undefined];
      },
      () => {
        if (opening?.ready === ready) opening = undefined;
      },
    );
  }
  return opening.ready;
}

/** `inner` is `outer` or inside it; Windows paths compare without case. */
function within(outer: string, inner: string): boolean {
  const rel = path.relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function writeToolboxConfig(root: string): Promise<void> {
  const s = await loadSettings();
  await mkdir(path.join(root, '.tutordesk'), { recursive: true });
  await writeFile(path.join(root, '.tutordesk', 'toolbox.json'), `${JSON.stringify({ studio: s.studio, tutorName: s.tutorName }, null, 2)}
`, 'utf8');
}

/** The tutor's edits to a proposal before confirming it. */
const ProposalEdit = z.object({ student: ProposedStudent, changes: ProfileChanges, lessons: z.array(ProposedLesson).max(30) }).partial();

const LessonPatch = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    minutes: z.number().int().min(15).max(240),
    topic: z.string(),
    status: LessonStatus,
  })
  .partial();

const claude = new ClaudeCliProvider({ auth: 'subscription' });

async function provider(): Promise<AgentProvider> {
  if (process.env.TUTORDESK_FAKE_AI === '1') return (await import('./fake-ai.js')).createFakeProvider();
  const s = await loadSettings();
  if (s.aiBackend === 'claude-cli') return claude;
  return new ApiProvider({ gateway: s.api.gateway, apiKey: await loadApiKey(s.api.gateway), baseURL: s.api.baseURL || undefined, models: s.api.models });
}

let tex: TexEngine | undefined;
async function texEngine(): Promise<TexEngine> {
  tex ??= new TexEngine(await texOptions());
  return tex;
}

const texDir = async () => path.join((await ws()).root, 'templates', 'tex');

const threads = new ThreadService({
  ws,
  tex: async () => {
    const engine = await texEngine();
    return (await engine.detect()) ? engine : undefined;
  },
});

const speech = new SpeechService();

/** Interface size: the whole window zooms, so layouts keep their proportions. */
export function applyZoom(scale: number | undefined): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.setZoomFactor(scale ?? 1);
}

export function closeThreads(): Promise<void> {
  speech.stop();
  return threads.closeAll();
}

async function pipeline(onEvent?: (e: PipelineEvent) => void, signal?: AbortSignal): Promise<LessonPipeline> {
  const s = await loadSettings();
  const engine = await texEngine();
  const hasTex = (await engine.detect()) !== null;
  return new LessonPipeline({
    ws: await ws(),
    provider: await provider(),
    tex: hasTex ? engine : undefined,
    templateDir: await texDir(),
    studio: s.studio,
    tutorName: s.tutorName || s.studio.name,
    onEvent,
    signal,
  });
}

/* ───────────────── runs: long AI jobs streamed to the renderer ───────────────── */

const runs = new Map<string, AbortController>();

function startRun(sender: WebContents, job: (emit: (e: RunEvent) => void, signal: AbortSignal) => Promise<unknown>): string {
  const runId = randomUUID();
  const ac = new AbortController();
  runs.set(runId, ac);
  const emit = (e: RunEvent) => {
    if (!sender.isDestroyed()) sender.send('run:event', runId, e);
  };
  void job(emit, ac.signal).then(
    (result) => emit({ type: 'finished', ok: true, result }),
    (e: Error) => emit({ type: 'finished', ok: false, error: ac.signal.aborted ? 'Cancelled' : e.message }),
  ).finally(() => runs.delete(runId));
  return runId;
}

const toRunEvent = (e: PipelineEvent): RunEvent => (e.type === 'agent' ? { type: 'agent', kind: e.kind, event: e.event } : e);

/* ───────────────── samples (Settings → Typesetting) ───────────────── */

const SAMPLE_FILES: Record<CompileSampleRequest['doc'], string> = { handout: 'handout-peel.tex', worksheet: 'worksheet-mixed.tex', script: 'lesson-script.tex', deck: 'deck.tex' };

async function compileSample(req: CompileSampleRequest): Promise<CompileOutcome> {
  const dir = await texDir();
  const samples = path.join(dir, 'samples');
  let mainTex = await readFile(path.join(samples, SAMPLE_FILES[req.doc]), 'utf8');
  const files: Record<string, string> = {};
  if (req.doc === 'deck') {
    const theme = BEAMER_THEMES.includes(req.theme) ? req.theme : 'tutorswiss';
    mainTex = mainTex.replace(/\\usetheme\{[^}]+\}/, `\\usetheme{${theme}}`);
    files['lesson-peel.tex'] = await readFile(path.join(samples, 'lesson-peel.tex'), 'utf8');
  }
  const r = await (await texEngine()).compileLatest(`sample:${req.doc}`, { mainTex, files, templateDir: dir, pretex: req.doc === 'deck' || req.mode === 'student' ? undefined : `\\def\\TDmode{${req.mode}}` });
  return { ok: r.ok, pdf: r.pdf ? new Uint8Array(r.pdf) : undefined, durationMs: r.durationMs, errors: r.errors.filter((e) => e.severity !== 'badbox').slice(0, 20), engine: r.engine.version };
}

/* ───────────────── IPC ───────────────── */

const FILE_OF: Record<ArtifactKind, string> = { handout: 'handout.json', worksheet: 'worksheet.json', script: 'script.json', deck: 'deck.json' };

async function lessonDetail(studentId: string, lessonId: string): Promise<LessonDetail> {
  const w = await ws();
  const lesson = await w.readLesson(studentId, lessonId);
  const plan = await w.readLessonJson(studentId, lessonId, 'plan.json', LessonPlan).catch(() => null);
  const docs: LessonDetail['docs'] = {};
  const qa: LessonDetail['qa'] = {};
  for (const k of ArtifactKind.options) {
    const d = await w.readLessonJson(studentId, lessonId, FILE_OF[k], ARTIFACT_SCHEMAS[k] as z.ZodType<ArtifactDoc>).catch(() => null);
    if (d) docs[k] = d;
  }
  for (const k of [...ArtifactKind.options, 'plan' as const]) {
    const r = await w.readLessonJson(studentId, lessonId, `qa/${k}.json`, z.any()).catch(() => null);
    if (r) qa[k] = r;
  }
  return { lesson, plan, docs, qa };
}

const MEDIA: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

async function submissionDetail(studentId: string, subId: string): Promise<SubmissionDetail> {
  const w = await ws();
  const { meta, text, dir } = await w.readSubmission(studentId, subId);
  const r = await readJson(path.join(dir, 'review.json'), z.any());
  let image: string | undefined;
  if (meta.original && MEDIA[path.extname(meta.original).toLowerCase()]) {
    image = `data:${MEDIA[path.extname(meta.original).toLowerCase()]};base64,${(await readFile(path.join(dir, meta.original))).toString('base64')}`;
  }
  return { meta, text, review: r.ok ? r.value : null, image };
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function registerIpc(): void {
  const h = (channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown) => ipcMain.handle(channel, (e, ...args) => fn(e, ...(args as never[])));

  // settings
  h('settings:get', () => loadSettings());
  h('threads:open', (_e, subject: Parameters<ThreadService['open']>[0]) => threads.open(subject));
  h('threads:send', (e, id: string, text: string) => threads.send(e.sender, id, text));
  h('threads:respond', (_e, id: string, requestId: string, decision: 'allow' | 'deny') => threads.respond(id, requestId, decision));
  h('threads:interrupt', (_e, id: string) => threads.interrupt(id));
  h('threads:configure', (_e, id: string, patch: Parameters<ThreadService['configure']>[1]) => threads.configure(id, patch));
  h('threads:attach', (_e, studentId: string) => threads.attach(studentId));
  h('agents:status', () => threads.status());
  h('settings:update', async (_e, raw: unknown) => {
    const patch = SettingsPatch.parse(raw);
    tex = undefined;
    const saved = await saveSettings(patch);
    if (workspace && workspace.root === saved.workspaceRoot) await writeToolboxConfig(workspace.root);
    if ('uiScale' in patch) applyZoom(saved.uiScale);
    return saved;
  });
  h('settings:pickWorkspace', async (): Promise<WorkspaceChoice | null> => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = path.resolve(r.filePaths[0]);
    const current = path.resolve((await loadSettings()).workspaceRoot);
    const names = await readdir(dir).catch(() => [] as string[]);
    const students = await readdir(path.join(current, 'students')).catch(() => [] as string[]);
    return { path: dir, same: dir === current, isWorkspace: names.includes('workspace.json'), empty: names.length === 0, currentStudents: students.length, inside: dir !== current && within(current, dir) };
  });
  h('settings:switchWorkspace', async (_e, dir: string, move: boolean) => {
    const target = path.resolve(dir);
    const current = path.resolve((await loadSettings()).workspaceRoot);
    if (target === current) return loadSettings();
    if (within(current, target)) throw new Error('The new folder cannot be inside the current one.');
    // Agents run in the workspace; stop them before it changes under them.
    await threads.closeAll();
    if (move) {
      const names = await readdir(target).catch(() => [] as string[]);
      if (names.length) throw new Error('Choose an empty folder to move the workspace into.');
      // Copy, never move: the old folder stays as it was until the tutor removes it.
      await cp(current, target, { recursive: true, errorOnExist: true, force: false });
    }
    return saveSettings({ workspaceRoot: target });
  });
  h('settings:setApiKey', (_e, key: string) => storeApiKey(key.trim()));
  h('settings:hasApiKey', async () => !!(await loadApiKey((await loadSettings()).api.gateway)));
  h('settings:defaultModels', (_e, gateway: keyof typeof DEFAULT_MODELS) => DEFAULT_MODELS[gateway]);

  // students
  h('students:list', async () => (await (await ws()).listStudents()).map((s) => (s.ok ? { ok: true, profile: s.profile } : { ok: false, id: s.id, issues: s.issues })));
  h('students:create', async (_e, input: unknown) => (await ws()).createStudent(NewStudentInput.parse(input)));
  h('students:get', async (_e, id: string): Promise<StudentDetail> => {
    const w = await ws();
    const profile = await w.readProfile(id);
    if (!profile.ok) throw new Error(profile.issues.join('; '));
    const [lessons, errors, history, submissions] = await Promise.all([w.listLessons(id), w.readErrors(id), w.history(id, 15), w.listSubmissions(id)]);
    return { profile: profile.value, lessons, errors: errors.items, history, submissions, dir: await w.studentDir(id) };
  });
  h('students:createLesson', async (_e, id: string, opts: { date: string; topic?: string; minutes?: number }) => (await ws()).createLesson(id, opts));
  h('students:reveal', async (_e, id: string) => {
    await shell.openPath(await (await ws()).studentDir(id));
  });
  h('students:update', async (_e, id: string, patch: unknown) => {
    const p = ProfileChanges.parse(patch);
    return (await ws()).updateProfile(id, (cur) => mergeProfile(cur, p), 'Update profile');
  });

  // voice input: local speech-to-text
  h('speech:status', () => speech.status());
  h('speech:install', (e) => speech.install(e.sender));
  h('speech:cancelInstall', () => speech.cancelInstall());
  h('speech:uninstall', () => speech.uninstall());
  h('speech:transcribe', (_e, samples: unknown) => speech.transcribe(samples));

  // proposals: agents propose, the tutor confirms here
  const proposals = async () => new ProposalStore((await ws()).root);
  h('proposals:list', async (_e, filter: { studentId?: string; kind?: 'student' | 'profile' | 'lessons' }) => (await proposals()).list({ ...filter, status: 'pending' }));
  h('proposals:apply', async (_e, id: string, edit: unknown, threadId?: string) => {
    const r = await applyProposal(await ws(), await proposals(), id, ProposalEdit.parse(edit ?? {}));
    if (threadId) await threads.note(threadId, `The tutor confirmed proposal ${id}${r.lessons.length ? ` (${r.lessons.length} lessons created)` : ''}.`);
    return r;
  });
  h('proposals:dismiss', async (_e, id: string, threadId?: string) => {
    await (await proposals()).setStatus(id, 'dismissed');
    if (threadId) await threads.note(threadId, `The tutor dismissed proposal ${id}.`);
  });
  h('students:setArchived', async (_e, id: string, archived: boolean) =>
    (await ws()).updateProfile(id, (cur) => ({ ...cur, archived: z.boolean().parse(archived) }), archived ? 'Archive student' : 'Restore student'),
  );
  h('students:delete', async (_e, id: string) => {
    await (await ws()).deleteStudent(id);
  });
  h('errors:setStatus', async (_e, id: string, errorId: string, status: unknown) => {
    const next = z.enum(['open', 'practicing', 'resolved']).parse(status);
    await (await ws()).updateErrors(id, (e) => (e.id === errorId ? { ...e, status: next } : e), `Mark error ${errorId} ${next}`);
  });
  h('errors:delete', async (_e, id: string, errorId: string) => {
    await (await ws()).updateErrors(id, (e) => (e.id === errorId ? null : e), `Remove error ${errorId}`);
  });

  // lessons
  h('lessons:get', (_e, s: string, l: string) => lessonDetail(s, l));
  h('lessons:update', async (_e, s: string, l: string, patch: unknown) => {
    const p = LessonPatch.parse(patch);
    return (await ws()).updateLesson(s, l, (x) => ({ ...x, ...p }), `Update lesson ${l}`);
  });
  h('lessons:delete', async (_e, s: string, l: string) => {
    await (await ws()).deleteLesson(s, l);
  });
  h('lessons:setBrief', async (_e, s: string, l: string, brief: string) => (await ws()).updateLesson(s, l, (x) => ({ ...x, brief })));
  h('lessons:attachMaterial', async (_e, s: string, l: string) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Text', extensions: ['txt', 'md'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    const w = await ws();
    const dir = path.join(await w.studentDir(s), 'materials', 'parsed');
    await mkdir(dir, { recursive: true });
    const added: string[] = [];
    for (const f of r.filePaths) {
      const name = `${l}-${path.basename(f).replace(/[^\w.-]+/g, '_')}`;
      await copyFile(f, path.join(dir, name));
      added.push(`materials/parsed/${name}`);
    }
    return w.updateLesson(s, l, (x) => ({ ...x, materials: [...new Set([...x.materials, ...added])] }), `Attach materials to ${l}`);
  });
  h('lessons:plan', (e, s: string, l: string, opts: { brief?: string; outputs: ArtifactKind[] }) =>
    startRun(e.sender, async (emit, signal) => (await pipeline((ev) => emit(toRunEvent(ev)), signal)).plan(s, l, opts)),
  );
  h('lessons:confirmPlan', async (_e, s: string, l: string, plan: unknown) => (await pipeline()).confirmPlan(s, l, LessonPlan.parse(plan)));
  h('lessons:generate', (e, s: string, l: string, kinds: ArtifactKind[]) =>
    startRun(e.sender, async (emit, signal) => {
      const p = await pipeline((ev) => emit(toRunEvent(ev)), signal);
      const out: Record<string, boolean> = {};
      for (const k of kinds) out[k] = (await p.generate(s, l, k)).report.passed;
      return out;
    }),
  );
  h('lessons:revise', (e, s: string, l: string, kind: ArtifactKind, instruction: string) =>
    startRun(e.sender, async (emit, signal) => (await (await pipeline((ev) => emit(toRunEvent(ev)), signal)).revise(s, l, kind, instruction)).report.passed),
  );
  h('lessons:exportPdf', async (_e, s: string, l: string, kind: ArtifactKind, mode: EditionMode, theme?: BeamerTheme): Promise<CompileOutcome> => {
    const r = await (await pipeline()).exportPdf(s, l, kind, mode, theme ?? (await loadSettings()).beamerTheme);
    return { ok: r.ok, pdf: r.pdf ? new Uint8Array(r.pdf) : undefined, durationMs: r.durationMs, errors: r.errors.filter((x) => x.severity === 'error') };
  });
  h('lessons:revealOutput', async (_e, s: string, l: string) => {
    const dir = path.join(await (await ws()).lessonDir(s, l), 'out');
    await mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });

  // submissions
  h('submissions:delete', async (_e, s: string, sub: string) => {
    await (await ws()).deleteSubmission(s, sub);
  });
  h('submissions:createText', async (_e, s: string, input: { kind: 'writing-task1' | 'writing-task2'; prompt: string; text: string }) => (await ws()).createSubmission(s, { ...input, date: today() }));
  h('submissions:createFromImage', async (_e, s: string, kind: 'writing-task1' | 'writing-task2') => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return (await ws()).createSubmission(s, { kind, image: { name: path.basename(r.filePaths[0]), data: await readFile(r.filePaths[0]) }, date: today() });
  });
  h('submissions:get', (_e, s: string, sub: string) => submissionDetail(s, sub));
  h('submissions:confirmText', async (_e, s: string, sub: string, text: string, prompt: string) => new WritingReviewer({ ws: await ws(), provider: await provider() }).confirmText(s, sub, text, prompt));
  h('submissions:transcribe', (e, s: string, sub: string) =>
    startRun(e.sender, async (emit, signal) => new WritingReviewer({ ws: await ws(), provider: await provider(), signal, onEvent: (event) => emit({ type: 'agent', kind: 'transcribe', event }) }).transcribe(s, sub)),
  );
  h('submissions:review', (e, s: string, sub: string) =>
    startRun(e.sender, async (emit, signal) => {
      emit({ type: 'step', step: 'review', kind: 'writing', status: 'start' });
      return new WritingReviewer({ ws: await ws(), provider: await provider(), signal, onEvent: (event) => emit({ type: 'agent', kind: 'writing', event }) }).review(s, sub);
    }),
  );
  h('submissions:finalise', async (_e, s: string, sub: string, finalBands: Record<string, number>, accepted: number[]) =>
    new WritingReviewer({ ws: await ws(), provider: await provider() }).finalise(s, sub, { finalBands, accepted }),
  );

  // runs
  h('runs:cancel', (_e, runId: string) => {
    runs.get(runId)?.abort();
  });

  // health
  h('health:ai', async () => ({ ...(await (await provider()).healthCheck()), backend: (await loadSettings()).aiBackend }));
  h('health:tex', async (_e, refresh?: boolean): Promise<TexStatus> => {
    const info = await (await texEngine()).detect(refresh ?? false);
    return info ? { found: true, kind: info.kind, version: info.version, binDir: info.binDir, hasLatexmk: !!info.latexmk, missingFiles: info.missingFiles } : { found: false, missingFiles: [] };
  });
  h('tex:compileSample', (_e, req: CompileSampleRequest) => compileSample(req));
}
