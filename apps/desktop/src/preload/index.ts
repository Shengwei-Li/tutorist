import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/ipc.js';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: DesktopApi = {
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    chooseWorkspace: () => invoke('settings:chooseWorkspace'),
  },
  students: {
    list: () => invoke('students:list'),
    create: (input) => invoke('students:create', input),
    get: (id) => invoke('students:get', id),
    createLesson: (id, opts) => invoke('students:createLesson', id, opts),
    reveal: (id) => invoke('students:reveal', id),
  },
  health: {
    claude: () => invoke('health:claude'),
    tex: (refresh) => invoke('health:tex', refresh),
  },
  tex: {
    compileSample: (req) => invoke('tex:compileSample', req),
  },
  agent: {
    testRun: () => invoke('agent:testRun'),
    cancel: (runId) => invoke('agent:cancel', runId),
    onEvent: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, runId: string, ev: Parameters<typeof cb>[1]) => cb(runId, ev);
      ipcRenderer.on('agent:event', listener);
      return () => ipcRenderer.removeListener('agent:event', listener);
    },
  },
};

contextBridge.exposeInMainWorld('tutordesk', api);
