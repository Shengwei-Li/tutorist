import { describe, expect, it } from 'vitest';
import { renderDeck } from '../src/index.js';
import { deck } from './fixtures/docs.js';

describe('deck regressions from the real-model eval', () => {
  it('strips markup and slashes from wrap-up words', () => {
    const d = structuredClone(deck);
    const f = d.frames.at(-1)!;
    if (f.type === 'frame' && f.blocks[0]!.type === 'wrapup') f.blocks[0]!.words = [{ word: 'concession', ipa: '/[[ipa:/kənˈseʃ.ən/]]/', gloss: '{{concession|admitting a point}}' }];
    const { tex } = renderDeck(d, { theme: 'tutorswiss', learner: 'Mina', tutor: 'T', lessonNumber: 1 });
    expect(tex).toContain(String.raw`\vocab{concession}{kənˈseʃ.ən}{concession}`);
    expect(tex).not.toMatch(/\[\[|\\{\\{/);
  });
});
