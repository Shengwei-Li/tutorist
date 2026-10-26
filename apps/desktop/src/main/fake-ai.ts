/**
 * Development-only provider (TUTORDESK_FAKE_AI=1): answers with fixture documents so the whole UI flow
 * can be exercised and screenshotted without an API key. Never enabled in normal use.
 */
import type { AgentProvider } from '@tutordesk/providers';
import { deck, handout, script, worksheet } from '../../../../packages/render/test/fixtures/docs.js';
import { FakeProvider, essay, plan90, promptKind, review, writingReview } from '../../../../packages/pipeline/test/fakes.js';

export function createFakeProvider(): AgentProvider {
  const docs = { handout, worksheet, script, deck } as const;
  let lastKind: keyof typeof docs = 'handout';
  return new FakeProvider((spec) => {
    const k = promptKind(spec.prompt);
    if (k === 'plan') return plan90;
    if (k === 'review') return review(5);
    if (k === 'essay') return writingReview;
    if (k === 'transcribe') return { text: essay, unsure: [] };
    if (k === 'revise') {
      const m = /Revise this (plan card|handout|worksheet|script|deck)/.exec(spec.prompt);
      if (m?.[1] === 'plan card') return plan90;
      const kind = (m?.[1] as keyof typeof docs | undefined) ?? lastKind;
      return docs[kind];
    }
    if (k in docs) {
      lastKind = k as keyof typeof docs;
      return docs[lastKind];
    }
    throw new Error(`fake AI: unrecognised prompt (${k})`);
  });
}
