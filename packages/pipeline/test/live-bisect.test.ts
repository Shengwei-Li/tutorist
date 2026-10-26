/** Finds which schema parts a provider rejects (TUTORDESK_LIVE_API=1). Development aid. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DeckBlock, DeckDoc, DeckFrame, DocMeta, Exercise, ExerciseItem, HandoutBlock, HandoutDoc, LessonPlan, RubricReview, ScriptDoc, WorksheetDoc } from '@tutordesk/core/artifacts';
import { portableSchema } from '@tutordesk/providers';

const key = process.env.OPENROUTER_API_KEY ?? '';
const model = process.env.BISECT_MODEL ?? 'google/gemini-3.8-flash';

async function probe(schema: z.ZodType): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Return an example.' }],
      response_format: { type: 'json_schema', json_schema: { name: 'x', strict: true, schema: portableSchema(z.toJSONSchema(schema, { target: 'draft-7' })) } },
    }),
  });
  if (res.ok) return "ok"; const t = await res.text(); try { return `${res.status} ${JSON.parse(JSON.parse(t).error.metadata.raw).error.message}`; } catch { return `${res.status} ${t.slice(0, 600)}`; }
}

describe.skipIf(process.env.TUTORDESK_LIVE_API !== '1' || !key)('schema bisect', () => {
  it('reports per schema', async () => {
    const parts: Record<string, z.ZodType> = {
      ...Object.fromEntries(ExerciseItem.options.map((o) => [`item:${(o.shape.type as z.ZodLiteral<string>).value}`, z.object({ x: o })])),
      itemUnion: z.object({ x: ExerciseItem }),
      exercise: Exercise,
      exArray: z.object({ x: z.array(Exercise) }),
      exWithMeta: z.object({ meta: DocMeta, x: Exercise }),
      exNested2: z.object({ a: z.object({ x: Exercise }) }),
      deckBlock: z.object({ x: DeckBlock }),
      deckBlocks: z.object({ x: z.array(DeckBlock) }),
      deckFrame: z.object({ x: DeckFrame }),
      deckFrames: z.object({ x: z.array(DeckFrame) }),
      handoutBlock: z.object({ x: HandoutBlock }),
      framesMax: z.object({ x: z.array(DeckFrame).max(16) }),
      framesMin: z.object({ x: z.array(DeckFrame).min(4) }),
      framesKindMeta: z.object({ kind: z.literal('deck'), meta: DeckDoc.shape.meta, x: z.array(DeckFrame) }),
      exArrayMax: z.object({ x: z.array(Exercise).max(8) }),
      worksheet: WorksheetDoc,
      handout: HandoutDoc,
      script: ScriptDoc,
      deck: DeckDoc,
      plan: LessonPlan,
      rubric: RubricReview,
    };
    const out: Record<string, string> = {};
    for (const [k, s] of Object.entries(parts)) out[k] = await probe(s);
    console.log(JSON.stringify(out, null, 1));
    expect(Object.values(out).every((v) => v === 'ok')).toBe(true);
  }, 600_000);
});
