import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { app, dialog, type WebContents } from 'electron';
import type { WorkspaceService } from '@tutordesk/core';
import {
  ApiSession,
  HARNESSES,
  ThreadStore,
  checkHarness,
  createSession,
  subjectInstructions,
  tutordeskMcpLaunch,
  type HarnessEvent,
  type HarnessSession,
  type ThreadEntry,
  type ThreadRecord,
} from '@tutordesk/harness';
import { createLanguageModel } from '@tutordesk/providers';
import type { TexEngine } from '@tutordesk/tex';
import { Toolbox, apiSystemPrompt } from '@tutordesk/toolbox';
import type { AgentId, AgentMode, AgentStatus, ThreadEvent, ThreadSubject, ThreadView } from '../shared/ipc.js';
import { loadApiKey, loadSettings } from './settings.js';

/** Compile-time check that the renderer's mirror matches the harness event type. */
const _sameShape: (e: HarnessEvent) => ThreadEvent = (e) => e;
void _sameShape;

export interface ThreadDeps {
  ws: () => Promise<WorkspaceService>;
  tex: () => Promise<TexEngine | undefined>;
}

/** The bundled MCP server: the repo build in development, a resource file when packaged. */
function mcpServerScript(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'tutordesk-mcp.mjs') : path.resolve(app.getAppPath(), '..', '..', 'packages', 'toolbox', 'dist', 'tutordesk-mcp.mjs');
}

interface Live {
  /** null while the agent is starting; `running` is already true then, so nothing else races in. */
  session: HarnessSession | null;
  agent: AgentId;
  mode: AgentMode;
  running: boolean;
  pending: Map<string, Extract<ThreadEvent, { type: 'approval' }>>;
  sender: WebContents | null;
}

/**
 * Threads about students, lessons and essays (appendix E.3.3). One live agent session per thread,
 * started on the first message and kept until the agent or mode changes. The harness keeps the full
 * conversation; the thread file keeps what the UI shows and which native session continues it.
 */
export class ThreadService {
  private live = new Map<string, Live>();
  /** open() calls in flight per subject, so a double mount does not create two threads. */
  private opening = new Map<string, Promise<ThreadView>>();
  /** What the tutor did outside the conversation (confirmed a card…), told to the agent with the next message. */
  private notes = new Map<string, string[]>();

  constructor(private readonly deps: ThreadDeps) {}

  private async store(): Promise<ThreadStore> {
    return new ThreadStore((await this.deps.ws()).root);
  }

  private view(t: ThreadRecord): ThreadView {
    const l = this.live.get(t.id);
    return {
      id: t.id,
      subject: t.subject as ThreadSubject,
      agent: t.harness,
      mode: t.mode,
      entries: t.entries as ThreadView['entries'],
      running: l?.running ?? false,
      pending: l ? [...l.pending.values()] : [],
    };
  }

  open(subject: ThreadSubject): Promise<ThreadView> {
    const key = JSON.stringify(subject);
    const inFlight = this.opening.get(key);
    if (inFlight) return inFlight;
    const p = this.openNow(subject).finally(() => this.opening.delete(key));
    this.opening.set(key, p);
    return p;
  }

  private async openNow(subject: ThreadSubject): Promise<ThreadView> {
    const store = await this.store();
    const filter = subject.type === 'lesson' ? { studentId: subject.studentId, lessonId: subject.lessonId } : subject.type === 'workspace' ? {} : { studentId: subject.studentId };
    const existing = (await store.list(filter)).find((t) => JSON.stringify(t.subject) === JSON.stringify(subject));
    if (existing) return this.view(existing);
    const s = await loadSettings();
    const title = subject.type === 'lesson' ? subject.lessonId : subject.type === 'submission' ? subject.submissionId : subject.type === 'student' ? subject.studentId : 'workspace';
    return this.view(await store.create({ title, subject, harness: s.agent, mode: s.agentMode }));
  }

  async configure(threadId: string, patch: { agent?: AgentId; mode?: AgentMode }): Promise<ThreadView> {
    const store = await this.store();
    const l = this.live.get(threadId);
    if (l?.running) throw new Error('Wait for the agent to finish, or stop it, before switching.');
    if (l) {
      this.live.delete(threadId);
      await l.session?.close();
    }
    const t = await store.update(threadId, (x) => ({
      ...x,
      harness: patch.agent ?? x.harness,
      mode: patch.mode ?? x.mode,
      entries: patch.agent && patch.agent !== x.harness ? [...x.entries, { role: 'system', text: `Switched to ${labelOf(patch.agent)}.`, at: now() }] : x.entries,
    }));
    return this.view(t);
  }

  /**
   * Start the thread's agent, continuing its native session when there is one. If that session cannot
   * be continued (deleted, expired, from another install), start a fresh one and say so in the thread.
   */
  private async startSession(t: ThreadRecord): Promise<HarnessSession> {
    const resume = t.sessions[t.harness];
    try {
      return await this.startWith(t, resume);
    } catch (err) {
      if (!resume) throw err;
      await this.forgetSession(t.id, t.harness, `Could not continue the earlier ${labelOf(t.harness)} conversation (${(err as Error).message}); starting a new one.`);
      return this.startWith(t, undefined);
    }
  }

  private async forgetSession(threadId: string, agent: AgentId, note: string): Promise<void> {
    const store = await this.store();
    await store.update(threadId, (x) => {
      const sessions = { ...x.sessions };
      delete sessions[agent];
      return { ...x, sessions, entries: [...x.entries, { role: 'system', text: note, at: now() }] };
    });
  }

  private async startWith(t: ThreadRecord, resume: string | undefined): Promise<HarnessSession> {
    const w = await this.deps.ws();
    const s = await loadSettings();
    const subject = t.subject as ThreadSubject;
    const profile = subject.type === 'workspace' ? null : await w.readProfile(subject.studentId).catch(() => null);
    const instructions = `${subjectInstructions(subject, { student: profile?.ok ? profile.value.name : undefined })} ${todayLine()}`;
    const base = { cwd: w.root, mode: t.mode, resume, instructions, mcp: { command: '', args: [] as string[] } };

    let session: HarnessSession;
    if (t.harness === 'api') {
      const tex = await this.deps.tex();
      const studio = s.studio;
      if (process.env.TUTORDESK_FAKE_AI === '1') {
        const { createFakeChatModel } = await import('./fake-ai.js');
        const toolbox = new Toolbox({ ws: w, tex, templateDir: path.join(w.root, 'templates', 'tex'), studio, tutorName: s.tutorName || studio.name, by: 'api:fake' });
        session = new ApiSession(base, { model: await createFakeChatModel(subject), modelLabel: 'fake', toolbox, system: apiSystemPrompt() });
      } else {
        const apiKey = await loadApiKey(s.api.gateway);
        if (!apiKey) throw new Error('Add an API key in Settings → AI connection first.');
        const modelId = s.api.models.quality;
        const model = createLanguageModel({ gateway: s.api.gateway, apiKey, baseURL: s.api.baseURL || undefined, models: s.api.models }, modelId);
        const toolbox = new Toolbox({ ws: w, tex, templateDir: path.join(w.root, 'templates', 'tex'), studio, tutorName: s.tutorName || studio.name, by: `api:${modelId}` });
        session = new ApiSession(base, { model, modelLabel: modelId, toolbox, system: apiSystemPrompt() });
      }
    } else {
      // Electron's own binary runs the MCP server as plain Node, so tutors need no Node install.
      const mcp = tutordeskMcpLaunch({ serverScript: mcpServerScript(), workspace: w.root, by: t.harness, runtime: process.execPath, electron: true, texBin: s.texBinDir || undefined });
      session = createSession(t.harness, { ...base, mcp });
    }
    try {
      await session.start();
    } catch (err) {
      // A half-started agent must not stay behind as a process.
      await session.close().catch(() => {});
      throw err;
    }
    return session;
  }

  async send(sender: WebContents, threadId: string, text: string): Promise<void> {
    const store = await this.store();
    const t = await store.get(threadId);
    if (!t) throw new Error('This conversation no longer exists.');
    let l = this.live.get(threadId);
    if (l?.running) throw new Error('The agent is still working on the previous message.');
    if (!l) {
      // Claim the thread before the first await: a second send or a configure now sees it running.
      l = { session: null, agent: t.harness, mode: t.mode, running: true, pending: new Map(), sender };
      this.live.set(threadId, l);
    }
    l.sender = sender;
    l.running = true;
    let session: HarnessSession;
    try {
      await store.append(threadId, { role: 'tutor', text, at: now() });
      session = l.session ??= await this.startSession(t);
    } catch (err) {
      if (!l.session) this.live.delete(threadId);
      l.running = false;
      throw err;
    }
    const notes = this.notes.get(threadId) ?? [];
    this.notes.delete(threadId);
    void this.pump(threadId, l, session, notes.length ? `[TutorDesk: ${notes.join(' ')} ${todayLine()}]\n\n${text}` : text);
  }

  /** Record something the tutor did outside the conversation, for the agent to hear with the next message. */
  async note(threadId: string, text: string): Promise<void> {
    this.notes.set(threadId, [...(this.notes.get(threadId) ?? []), text]);
  }

  private async pump(threadId: string, l: Live, session: HarnessSession, text: string): Promise<void> {
    const store = await this.store();
    const emit = (e: ThreadEvent) => {
      if (l.sender && !l.sender.isDestroyed()) l.sender.send('thread:event', threadId, e);
    };
    let reply = '';
    const inputs = new Map<string, unknown>();
    const done: ThreadEntry[] = [];
    // The window hears turn_end only after the entries are saved and the thread is free again, so a
    // quick follow-up message neither races these writes nor finds the thread still busy.
    let end: Extract<ThreadEvent, { type: 'turn_end' }> = { type: 'turn_end', status: 'failed', error: 'The agent stopped without finishing.' };
    const flushReply = () => {
      if (reply.trim()) done.push({ role: 'agent', text: reply.trim(), at: now(), by: l.agent });
      reply = '';
    };
    try {
      for await (const e of session.send({ text })) {
        if (e.type === 'session' && session.nativeId) {
          const id = session.nativeId;
          await store.update(threadId, (x) => ({ ...x, sessions: { ...x.sessions, [l.agent]: id } })).catch(() => {});
        }
        if (e.type === 'text') reply += e.delta;
        if (e.type === 'tool' && e.status === 'running') inputs.set(e.id, e.input);
        if (e.type === 'tool' && e.status !== 'running') {
          flushReply();
          done.push({ role: 'tool', name: e.name, ok: e.status === 'ok', summary: e.summary?.split('\n')[0]?.slice(0, 200), target: toolTarget(inputs.get(e.id)), at: now() });
        }
        if (e.type === 'approval') l.pending.set(e.requestId, e);
        if (e.type === 'turn_end') {
          flushReply();
          if (e.status === 'failed') done.push({ role: 'system', text: e.error ? `Stopped: ${e.error}` : 'The agent stopped with an error.', at: now() });
          if (e.status === 'interrupted') done.push({ role: 'system', text: 'Stopped.', at: now() });
          end = e;
          continue;
        }
        emit(e);
      }
    } catch (err) {
      flushReply();
      const message = (err as Error).message;
      done.push({ role: 'system', text: `Stopped: ${message}`, at: now() });
      end = { type: 'turn_end', status: 'failed', error: message };
      // The loop broke early: the agent must not be left mid-turn.
      await session.interrupt().catch(() => {});
    } finally {
      l.pending.clear();
      // A dead agent is dropped and the next message starts a new one. If it never completed a turn,
      // the native session it resumed is not worth resuming again.
      const dead = session.dead;
      const forget = dead && !session.proven;
      if (dead) {
        if (this.live.get(threadId) === l) this.live.delete(threadId);
        await session.close().catch(() => {});
        done.push({ role: 'system', text: `${labelOf(l.agent)} has stopped; your next message starts it again.`, at: now() });
      }
      const nativeId = session.nativeId;
      try {
        await store.update(threadId, (x) => {
          const sessions = { ...x.sessions };
          if (forget) delete sessions[l.agent];
          else if (nativeId) sessions[l.agent] = nativeId;
          return { ...x, sessions, entries: [...x.entries, ...done] };
        });
      } catch {
        // The thread file is gone or unwritable; the live events already reached the window.
      }
      l.running = false;
      emit(end);
    }
  }

  respond(threadId: string, requestId: string, decision: 'allow' | 'deny'): void {
    const l = this.live.get(threadId);
    if (!l?.session) return;
    l.pending.delete(requestId);
    l.session.respond(requestId, decision);
  }

  async interrupt(threadId: string): Promise<void> {
    await this.live.get(threadId)?.session?.interrupt();
  }

  async attach(studentId: string): Promise<string[]> {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Materials', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'docx'] }] });
    if (r.canceled || !r.filePaths.length) return [];
    const w = await this.deps.ws();
    const dir = path.join(await w.studentDir(studentId), 'materials', 'raw');
    await mkdir(dir, { recursive: true });
    const out: string[] = [];
    for (const f of r.filePaths) {
      const name = path.basename(f).replace(/[^\w.-]+/g, '_');
      await copyFile(f, path.join(dir, name));
      out.push(`students/${studentId}/materials/raw/${name}`);
    }
    await w.commit(studentId, `Add materials ${out.map((p) => path.basename(p)).join(', ')}`);
    return out;
  }

  async status(): Promise<AgentStatus[]> {
    const out: AgentStatus[] = await Promise.all(
      HARNESSES.map(async (h) => {
        const r = await checkHarness(h.id).catch(() => null);
        if (!r) return { id: h.id, label: h.label, ready: false, installed: false, detail: 'Could not check.' };
        return { id: h.id, label: h.label, ready: r.installed && r.authed === true, installed: r.installed, version: r.version, detail: r.detail };
      }),
    );
    const s = await loadSettings();
    const hasKey = process.env.TUTORDESK_FAKE_AI === '1' || Boolean(await loadApiKey(s.api.gateway));
    out.push({ id: 'api', label: 'API', ready: hasKey, installed: true, version: s.api.models.quality, detail: hasKey ? undefined : 'Add an API key in Settings.' });
    return out;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.live.values()].map((l) => l.session?.close().catch(() => {})));
    this.live.clear();
  }
}

/** The one detail worth keeping from a tool's input for the log line. */
export function toolTarget(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const i = input as Record<string, unknown>;
  const v = i.kind ?? i.topic ?? i.path ?? i.file_path ?? i.pattern ?? i.query ?? i.name ?? i.command;
  return typeof v === 'string' ? v.slice(0, 120) : undefined;
}

function now(): string {
  return new Date().toISOString();
}

/** Agents schedule lessons from relative dates ("next Tuesday"), so they need the tutor's local date. */
function todayLine(): string {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `Today is ${d.toLocaleDateString('en-GB', { weekday: 'long' })} ${iso}.`;
}

function labelOf(agent: AgentId): string {
  return agent === 'api' ? 'API' : (HARNESSES.find((h) => h.id === agent)?.label ?? agent);
}

