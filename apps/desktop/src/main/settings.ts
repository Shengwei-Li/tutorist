import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { writeJson } from '@tutordesk/core';
import { BEAMER_THEMES, type AppSettings } from '../shared/ipc.js';

const file = () => path.join(app.getPath('userData'), 'settings.json');

function defaults(): AppSettings {
  return {
    // TUTORDESK_WORKSPACE lets development and tests point at a scratch workspace.
    workspaceRoot: process.env.TUTORDESK_WORKSPACE ? path.resolve(process.env.TUTORDESK_WORKSPACE) : path.join(app.getPath('documents'), 'TutorDesk'),
    language: app.getLocale().startsWith('zh') ? 'zh' : 'en',
    beamerTheme: 'tutorswiss',
  };
}

let cache: AppSettings | undefined;

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  let stored: Partial<AppSettings> = {};
  try {
    stored = JSON.parse(await readFile(file(), 'utf8')) as Partial<AppSettings>;
  } catch {
    /* first run */
  }
  const merged = { ...defaults(), ...stored };
  if (process.env.TUTORDESK_WORKSPACE) merged.workspaceRoot = path.resolve(process.env.TUTORDESK_WORKSPACE);
  if (!BEAMER_THEMES.includes(merged.beamerTheme)) merged.beamerTheme = 'tutorswiss';
  cache = merged;
  return merged;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await loadSettings()), ...patch };
  cache = next;
  await writeJson(file(), next);
  return next;
}
