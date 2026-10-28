import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, RunEvent, ThreadEvent } from '../shared/ipc.js';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: DesktopApi = {
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    pickWorkspace: () => invoke('settings:pickWorkspace'),
    switchWorkspace: (path, move) => invoke('settings:switchWorkspace', path, move),
    setApiKey: (key) => invoke('settings:setApiKey', key),
    hasApiKey: () => invoke('settings:hasApiKey'),
    defaultModels: (gateway) => invoke('settings:defaultModels', gateway),
  },
  students: {
    list: () => invoke('students:list'),
    create: (input) => invoke('students:create', input),
    get: (id) => invoke('students:get', id),
    createLesson: (id, opts) => invoke('students:createLesson', id, opts),
    reveal: (id) => invoke('students:reveal', id),
    update: (id, patch) => invoke('students:update', id, patch),
    setArchived: (id, archived) => invoke('students:setArchived', id, archived),
    delete: (id) => invoke('students:delete', id),
  },
  errors: {
    setStatus: (s, e, status) => invoke('errors:setStatus', s, e, status),
    delete: (s, e) => invoke('errors:delete', s, e),
  },
  lessons: {
    get: (s, l) => invoke('lessons:get', s, l),
    setBrief: (s, l, brief) => invoke('lessons:setBrief', s, l, brief),
    update: (s, l, patch) => invoke('lessons:update', s, l, patch),
    delete: (s, l) => invoke('lessons:delete', s, l),
    attachMaterial: (s, l) => invoke('lessons:attachMaterial', s, l),
    plan: (s, l, opts) => invoke('lessons:plan', s, l, opts),
    confirmPlan: (s, l, plan) => invoke('lessons:confirmPlan', s, l, plan),
    generate: (s, l, kinds) => invoke('lessons:generate', s, l, kinds),
    revise: (s, l, kind, instruction) => invoke('lessons:revise', s, l, kind, instruction),
    exportPdf: (s, l, kind, mode, theme) => invoke('lessons:exportPdf', s, l, kind, mode, theme),
    revealOutput: (s, l) => invoke('lessons:revealOutput', s, l),
  },
  submissions: {
    delete: (s, sub) => invoke('submissions:delete', s, sub),
    createText: (s, input) => invoke('submissions:createText', s, input),
    createFromImage: (s, kind) => invoke('submissions:createFromImage', s, kind),
    get: (s, sub) => invoke('submissions:get', s, sub),
    confirmText: (s, sub, text, prompt) => invoke('submissions:confirmText', s, sub, text, prompt),
    transcribe: (s, sub) => invoke('submissions:transcribe', s, sub),
    review: (s, sub) => invoke('submissions:review', s, sub),
    finalise: (s, sub, bands, accepted) => invoke('submissions:finalise', s, sub, bands, accepted),
  },
  runs: {
    cancel: (runId) => invoke('runs:cancel', runId),
    onEvent: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, runId: string, ev: RunEvent) => cb(runId, ev);
      ipcRenderer.on('run:event', listener);
      return () => ipcRenderer.removeListener('run:event', listener);
    },
  },
  proposals: {
    list: (filter) => invoke('proposals:list', filter),
    apply: (id, edit, threadId) => invoke('proposals:apply', id, edit, threadId),
    dismiss: (id, threadId) => invoke('proposals:dismiss', id, threadId),
  },
  threads: {
    open: (subject) => invoke('threads:open', subject),
    send: (id, text) => invoke('threads:send', id, text),
    respond: (id, requestId, decision) => invoke('threads:respond', id, requestId, decision),
    interrupt: (id) => invoke('threads:interrupt', id),
    configure: (id, patch) => invoke('threads:configure', id, patch),
    attach: (studentId) => invoke('threads:attach', studentId),
    onEvent: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, threadId: string, ev: ThreadEvent) => cb(threadId, ev);
      ipcRenderer.on('thread:event', listener);
      return () => ipcRenderer.removeListener('thread:event', listener);
    },
  },
  agents: {
    status: () => invoke('agents:status'),
  },
  health: {
    ai: () => invoke('health:ai'),
    tex: (refresh) => invoke('health:tex', refresh),
  },
  tex: {
    compileSample: (req) => invoke('tex:compileSample', req),
  },
};

contextBridge.exposeInMainWorld('tutordesk', api);
