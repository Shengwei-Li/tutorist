import { z } from 'zod';
import { AGENTS, API_GATEWAYS, BEAMER_THEMES, UI_SCALES } from '../shared/ipc.js';

/** A model id as an agent takes it ("opus", "gpt-6-luna", "opencode/big-pickle", "claude-opus-5-5[1m]"). */
export const ModelId = z.string().regex(/^\w[\w.:/@[\]-]{0,199}$/);

/**
 * What the window may change. The workspace folder (switched through its own checks) and the TeX
 * folder (whose programs run) are not on the list.
 */
export const SettingsPatch = z
  .object({
    language: z.enum(['en', 'zh']),
    beamerTheme: z.enum(BEAMER_THEMES),
    aiBackend: z.enum(['claude-cli', 'api']),
    agent: z.enum(AGENTS),
    agentMode: z.enum(['guarded', 'collaborate', 'full']),
    agentModels: z.object({ 'claude-code': ModelId, codex: ModelId, opencode: ModelId }).partial().strict(),
    api: z.object({
      gateway: z.enum(API_GATEWAYS),
      baseURL: z.union([z.url({ protocol: /^https?$/ }).max(500), z.literal('')]).optional(),
      models: z.object({ quality: z.string().max(200), balanced: z.string().max(200), fast: z.string().max(200) }),
    }),
    studio: z.object({ name: z.string().max(200), monogram: z.string().max(3) }),
    tutorName: z.string().max(200),
    voiceLanguage: z.enum(['english', 'chinese']),
    voiceEngine: z.enum(['local', 'cloud']),
    uiScale: z.union(UI_SCALES.map((s) => z.literal(s))),
    pet: z.boolean(),
  })
  .partial()
  .strict();
