import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app, dialog, ipcMain, shell, type WebContents } from 'electron';
import { z } from 'zod';
import { NewStudentInput, WorkspaceService } from '@tutordesk/core';
import { ClaudeCliProvider, runStructured } from '@tutordesk/providers';
import { TexEngine } from '@tutordesk/tex';
import { BEAMER_THEMES, type CompileOutcome, type CompileSampleRequest, type DesktopApi, type StudentDetail, type TexStatus } from '../shared/ipc.js';
import { loadSettings, saveSettings } from './settings.js';

/** Bundled workspace template: repo folder in development, resources folder when packaged. */
function templateRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'workspace-template')
    : path.resolve(app.getAppPath(), '..', '..', 'workspace-template');
}

let workspace: WorkspaceService | undefined;
async function ws(): Promise<WorkspaceService> {
  const { workspaceRoot } = await loadSettings();
  if (!workspace || workspace.root !== workspaceRoot) workspace = await WorkspaceService.init(workspaceRoot, templateRoot());
  return workspace;
}

const claude = new ClaudeCliProvider({ auth: 'subscription' });
let tex: TexEngine | undefined;
async function texEngine(): Promise<TexEngine> {
  const { texBinDir } = await loadSettings();
  tex ??= new TexEngine({ binDir: texBinDir });
  return tex;
}

const SAMPLE_FILES: Record<CompileSampleRequest['doc'], string> = {
  handout: 'handout-peel.tex',
  worksheet: 'worksheet-mixed.tex',
  script: 'lesson-script.tex',
  deck: 'deck.tex',
};

async function compileSample(req: CompileSampleRequest): Promise<CompileOutcome> {
  const w = await ws();
  const texDir = path.join(w.root, 'templates', 'tex');
  const samples = path.join(texDir, 'samples');
  let mainTex = await readFile(path.join(samples, SAMPLE_FILES[req.doc]), 'utf8');
  const files: Record<string, string> = {};
  if (req.doc === 'deck') {
    const theme = BEAMER_THEMES.includes(req.theme) ? req.theme : 'tutorswiss';
    mainTex = mainTex.replace(/\\usetheme\{[^}]+\}/, `\\usetheme{${theme}}`);
    files['lesson-peel.tex'] = await readFile(path.join(samples, 'lesson-peel.tex'), 'utf8');
  }
  const engine = await texEngine();
  const r = await engine.compileLatest(`sample:${req.doc}`, {
    mainTex,
    files,
    templateDir: texDir,
    pretex: req.doc === 'deck' || req.mode === 'student' ? undefined : `\\def\\TDmode{${req.mode}}`,
  });
  return {
    ok: r.ok,
    pdf: r.pdf ? new Uint8Array(r.pdf) : undefined,
    durationMs: r.durationMs,
    errors: r.errors.filter((e) => e.severity !== 'badbox').slice(0, 20),
    engine: `${r.engine.version}`,
  };
}

/** Test task for the connection screen: one structured answer through the user's own Claude Code login. */
const BandLabel = z.object({
  label: z.string().describe('Short CEFR-style descriptor for the band'),
  overall: z.number().describe('IELTS overall band after rounding'),
  explanation: z.string().describe('One sentence explaining the rounding'),
});

const runs = new Map<string, AbortController>();

async function startTestRun(sender: WebContents): Promise<string> {
  const runId = randomUUID();
  const ac = new AbortController();
  runs.set(runId, ac);
  const w = await ws();
  const send = (ev: unknown) => {
    if (!sender.isDestroyed()) sender.send('agent:event', runId, ev);
  };
  void runStructured(
    claude,
    {
      taskType: 'extract',
      workspaceRoot: w.root,
      model: 'haiku',
      prompt: 'An IELTS candidate scored Listening 6.5, Reading 7.0, Writing 6.0, Speaking 6.0. Give the overall band using official rounding, a short label, and one sentence explaining the rounding.',
      permissions: { writableGlobs: [], readableGlobs: [], allowShell: false, allowNetwork: false },
      budget: { maxUsd: 0.05 },
    },
    BandLabel,
    { signal: ac.signal, onEvent: send },
  ).then((r) => {
    runs.delete(runId);
    send({ type: 'finished', result: r.ok ? { ok: true, value: r.value, attempts: r.attempts, usd: r.usd } : { ok: false, error: r.error, issues: r.issues, attempts: r.attempts, usd: r.usd } });
  });
  return runId;
}

type Handlers = {
  [K in keyof DesktopApi]: { [M in keyof DesktopApi[K]]: DesktopApi[K][M] };
};

export function registerIpc(): void {
  const h = (channel: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: never[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => fn(e, ...(args as never[])));

  h('settings:get', () => loadSettings());
  h('settings:update', (_e, patch: Parameters<Handlers['settings']['update']>[0]) => {
    tex = undefined;
    return saveSettings(patch);
  });
  h('settings:chooseWorkspace', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return saveSettings({ workspaceRoot: r.filePaths[0] });
  });

  h('students:list', async () => {
    const list = await (await ws()).listStudents();
    return list.map((s) => (s.ok ? { ok: true, profile: s.profile } : { ok: false, id: s.id, issues: s.issues }));
  });
  h('students:create', async (_e, input: unknown) => (await ws()).createStudent(NewStudentInput.parse(input)));
  h('students:get', async (_e, id: string): Promise<StudentDetail> => {
    const w = await ws();
    const profile = await w.readProfile(id);
    if (!profile.ok) throw new Error(profile.issues.join('; '));
    const [lessons, errors, history] = await Promise.all([w.listLessons(id), w.readErrors(id), w.history(id, 15)]);
    return { profile: profile.value, lessons, errors: errors.items, history, dir: await w.studentDir(id) };
  });
  h('students:createLesson', async (_e, id: string, opts: { date: string; topic?: string; minutes?: number }) => (await ws()).createLesson(id, opts));
  h('students:reveal', async (_e, id: string) => {
    await shell.openPath(await (await ws()).studentDir(id));
  });

  h('health:claude', () => claude.healthCheck());
  h('health:tex', async (_e, refresh?: boolean): Promise<TexStatus> => {
    const info = await (await texEngine()).detect(refresh ?? false);
    return info
      ? { found: true, kind: info.kind, version: info.version, binDir: info.binDir, hasLatexmk: !!info.latexmk, missingFiles: info.missingFiles }
      : { found: false, missingFiles: [] };
  });
  h('tex:compileSample', (_e, req: CompileSampleRequest) => compileSample(req));

  h('agent:testRun', (e) => startTestRun(e.sender));
  h('agent:cancel', (_e, runId: string) => {
    runs.get(runId)?.abort();
  });
}
