import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { writeFileAtomic, writeJson } from '@tutordesk/core';
import { DEFAULT_MODELS } from '@tutordesk/providers';
import { API_GATEWAYS, BEAMER_THEMES, type AppSettings } from '../shared/ipc.js';

const file = () => path.join(app.getPath('userData'), 'settings.json');
const keyFile = () => path.join(app.getPath('userData'), 'api-key.bin');

function defaults(): AppSettings {
  return {
    // TUTORDESK_WORKSPACE lets development and tests point at a scratch workspace.
    workspaceRoot: process.env.TUTORDESK_WORKSPACE ? path.resolve(process.env.TUTORDESK_WORKSPACE) : path.join(app.getPath('documents'), 'TutorDesk'),
    language: app.getLocale().startsWith('zh') ? 'zh' : 'en',
    beamerTheme: 'tutorswiss',
    aiBackend: 'api',
    api: { gateway: 'openrouter', models: { ...DEFAULT_MODELS.openrouter } },
    studio: { name: 'My Tutoring Studio', monogram: 'TS' },
    tutorName: '',
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
  const d = defaults();
  const merged: AppSettings = { ...d, ...stored, api: { ...d.api, ...stored.api, models: { ...d.api.models, ...stored.api?.models } }, studio: { ...d.studio, ...stored.studio } };
  if (process.env.TUTORDESK_WORKSPACE) merged.workspaceRoot = path.resolve(process.env.TUTORDESK_WORKSPACE);
  if (process.env.TUTORDESK_AI_BACKEND === 'api' || process.env.TUTORDESK_AI_BACKEND === 'claude-cli') merged.aiBackend = process.env.TUTORDESK_AI_BACKEND;
  if (!BEAMER_THEMES.includes(merged.beamerTheme)) merged.beamerTheme = 'tutorswiss';
  if (!API_GATEWAYS.includes(merged.api.gateway)) merged.api.gateway = 'openrouter';
  cache = merged;
  return merged;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await loadSettings()), ...patch };
  cache = next;
  await writeJson(file(), next);
  return next;
}

/** API key at rest: encrypted with the OS keychain when available (SPEC §7.8). */
export async function storeApiKey(key: string): Promise<{ stored: boolean; encrypted: boolean }> {
  if (!key) {
    await rm(keyFile(), { force: true });
    return { stored: false, encrypted: false };
  }
  const encrypted = safeStorage.isEncryptionAvailable();
  const data = encrypted ? safeStorage.encryptString(key).toString('base64') : `plain:${Buffer.from(key).toString('base64')}`;
  await writeFileAtomic(keyFile(), data);
  return { stored: true, encrypted };
}

const ENV_KEY: Record<AppSettings['api']['gateway'], string | undefined> = {
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'openai-compatible': undefined,
};

export async function loadApiKey(gateway: AppSettings['api']['gateway']): Promise<string> {
  // Environment variables win, so tests and power users never need the keychain.
  const envName = ENV_KEY[gateway];
  const env = process.env.TUTORDESK_API_KEY ?? (envName ? process.env[envName] : undefined);
  if (env) return env;
  try {
    const data = await readFile(keyFile(), 'utf8');
    if (data.startsWith('plain:')) return Buffer.from(data.slice(6), 'base64').toString('utf8');
    return safeStorage.decryptString(Buffer.from(data, 'base64'));
  } catch {
    return '';
  }
}
