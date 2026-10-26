/**
 * Live checks against a real API (TUTORDESK_LIVE_API=1 + OPENROUTER_API_KEY). Verifies the key and that
 * each tier's model accepts our real schemas. Costs a few cents.
 */
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WorksheetDoc, WritingReview } from '@tutordesk/core/artifacts';
import { ApiProvider, DEFAULT_MODELS, runStructured, type AgentEvent, type ModelTier } from '@tutordesk/providers';
import { essay } from './fakes.js';

const key = process.env.OPENROUTER_API_KEY ?? '';
const run = process.env.TUTORDESK_LIVE_API === '1' && key.length > 0;

describe.skipIf(!run)('live OpenRouter', () => {
  const p = new ApiProvider({ gateway: 'openrouter', apiKey: key, models: DEFAULT_MODELS.openrouter });
  const spec = async (prompt: string, model: ModelTier) => ({
    taskType: 'extract' as const,
    workspaceRoot: await mkdtemp(path.join(os.tmpdir(), 'tutordesk-live-')),
    prompt,
    model,
    permissions: { writableGlobs: [], readableGlobs: [], allowShell: false, allowNetwork: false },
  });
  const usage = (events: AgentEvent[]) => events.filter((e) => e.type === 'usage').map((e) => (e.type === 'usage' ? `${e.inputTokens}/${e.outputTokens}${e.usd !== undefined ? ` $${e.usd.toFixed(4)}` : ''}` : '')).join(', ');

  it('key is valid', async () => {
    const h = await p.healthCheck();
    expect(h.ok, h.detail).toBe(true);
  }, 30_000);

  for (const tier of ['quality', 'balanced', 'fast'] as const) {
    it(`${tier} (${DEFAULT_MODELS.openrouter[tier]}) returns a simple structured object`, async () => {
      const r = await runStructured(p, await spec('IELTS scores L6.5 R7 W6 S6. Give the overall band (official rounding) and one sentence why.', tier), z.object({ overall: z.number(), why: z.string() }));
      console.log(tier, r.ok ? r.value : r, usage(r.events));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.overall).toBe(6.5);
    }, 120_000);
  }

  it('quality model fills the full worksheet schema', async () => {
    const r = await runStructured(
      p,
      await spec('Write a short IELTS worksheet for a band 6 student: one exercise with a 150-word original passage and three TFNG statements, and one exercise with two MCQs. Include answers.', 'quality'),
      WorksheetDoc,
    );
    console.log('worksheet', r.ok ? `${r.value.exercises.length} exercises, attempts ${r.attempts}` : r.error, r.ok ? '' : r.issues, usage(r.events));
    expect(r.ok).toBe(true);
  }, 240_000);

  it('quality model fills the writing-review schema', async () => {
    const r = await runStructured(p, await spec(`Review this IELTS Task 2 essay. Use codes like W-GRA-SVA.\n\n${essay}`, 'quality'), WritingReview);
    console.log('review', r.ok ? r.value.criteria.map((c) => `${c.id} ${c.low}-${c.high}`).join(', ') : r.error, r.ok ? '' : r.issues, usage(r.events));
    expect(r.ok).toBe(true);
  }, 240_000);
});
