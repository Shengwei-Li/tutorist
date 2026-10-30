import { describe, expect, it } from 'vitest';
import { SettingsPatch } from '../src/main/settings-patch.js';

describe('SettingsPatch', () => {
  it('takes what the Settings page changes', () => {
    const api = { gateway: 'openrouter', baseURL: '', models: { quality: 'a', balanced: 'b', fast: 'c' } };
    expect(SettingsPatch.parse({ api, uiScale: 1.25, voiceEngine: 'cloud', pet: false })).toMatchObject({ uiScale: 1.25 });
    expect(SettingsPatch.safeParse({ api: { ...api, gateway: 'openai-compatible', baseURL: 'http://localhost:11434/v1' } }).success).toBe(true);
    expect(SettingsPatch.safeParse({ agentModels: { 'claude-code': 'claude-opus-5-5[1m]', codex: 'gpt-6-luna', opencode: 'opencode/big-pickle' } }).success).toBe(true);
  });

  it('refuses the workspace and TeX folders, unknown keys and bad values', () => {
    for (const bad of [{ workspaceRoot: 'C:/' }, { texBinDir: 'C:/evil' }, { uiScale: 3 }, { agentMode: 'root' }, { agentModels: { codex: '--yolo' } }, { agentModels: { api: 'x' } }, { api: { gateway: 'openai-compatible', baseURL: 'file:///etc', models: { quality: '', balanced: '', fast: '' } } }])
      expect(SettingsPatch.safeParse(bad).success).toBe(false);
  });
});
