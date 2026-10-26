import path from 'node:path';
import { z } from 'zod';
import { readJson, writeJson, type WorkspaceService } from '@tutordesk/core';
import { WritingReview } from '@tutordesk/core/artifacts';
import { runStructured, type AgentEvent, type AgentProvider, type ModelTier } from '@tutordesk/providers';
import { buildContext } from './context.js';
import { ERROR_CODE_RE } from './knowledge.js';
import { TRANSCRIBE_PROMPT, systemFor, writingReviewPrompt } from './prompts.js';

export interface AnchoredAnnotation {
  index: number;
  quote: string;
  kind: 'grammar' | 'lexis' | 'cohesion' | 'task';
  code: string;
  explanation: string;
  suggestion: string;
  /** Character offsets in text.md; null when the quote could not be found. */
  start: number | null;
  end: number | null;
}

export interface StoredReview {
  review: WritingReview;
  annotations: AnchoredAnnotation[];
  wordCount: number;
  issues: string[];
  usd: number;
  model?: string;
  at: string;
}

const Transcription = z.object({
  text: z.string().min(1),
  unsure: z.array(z.string()).max(30).describe('Words or phrases you could not read with confidence'),
});

export function countWords(text: string): number {
  return (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length;
}

/** Find a quote in the essay, tolerating whitespace and quote-mark differences. */
export function locate(text: string, quote: string, from = 0): [number, number] | null {
  const exact = text.indexOf(quote, from);
  if (exact >= 0) return [exact, exact + quote.length];
  const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const words = norm(quote).trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return null;
  const re = new RegExp(words.join('\\s+'), 'i');
  const m = re.exec(norm(text).slice(from));
  return m ? [from + m.index, from + m.index + m[0].length] : null;
}

const STEP = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;

export function validateReview(review: WritingReview, task: 'task1' | 'task2', anchored: AnchoredAnnotation[]): string[] {
  const issues: string[] = [];
  const expected = task === 'task1' ? ['TA', 'CC', 'LR', 'GRA'] : ['TR', 'CC', 'LR', 'GRA'];
  const got = review.criteria.map((c) => c.id).sort();
  if (got.join() !== [...expected].sort().join()) issues.push(`Criteria must be ${expected.join(', ')}; got ${got.join(', ')}.`);
  for (const c of review.criteria) {
    if (!STEP(c.low) || !STEP(c.high)) issues.push(`${c.id}: bands must be in half-band steps.`);
    if (c.low > c.high) issues.push(`${c.id}: low ${c.low} is above high ${c.high}.`);
    if (c.high - c.low > 1) issues.push(`${c.id}: range ${c.low}–${c.high} is wider than one band.`);
  }
  const bad = anchored.filter((a) => !ERROR_CODE_RE.test(a.code));
  if (bad.length) issues.push(`Unknown error codes: ${[...new Set(bad.map((a) => a.code))].join(', ')}.`);
  const missing = anchored.filter((a) => a.start === null);
  if (missing.length > Math.max(2, anchored.length * 0.2)) issues.push(`${missing.length} annotation quotes are not exact copies from the essay.`);
  return issues;
}

export interface WritingOptions {
  ws: WorkspaceService;
  provider: AgentProvider;
  tiers?: Partial<Record<'transcribe' | 'review', ModelTier>>;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

export class WritingReviewer {
  constructor(private readonly o: WritingOptions) {}

  /** Photo → text. The tutor must confirm the transcription before review (SPEC §4.2). */
  async transcribe(studentId: string, subId: string): Promise<{ text: string; unsure: string[] }> {
    const { meta, dir } = await this.o.ws.readSubmission(studentId, subId);
    if (!meta.original) throw new Error('This submission has no image.');
    const ext = path.extname(meta.original).slice(1).toLowerCase();
    const mediaType = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const r = await runStructured(
      this.o.provider,
      {
        taskType: 'extract',
        workspaceRoot: await this.o.ws.studentDir(studentId),
        prompt: TRANSCRIBE_PROMPT,
        model: this.o.tiers?.transcribe ?? 'balanced',
        attachments: [{ path: path.relative(await this.o.ws.studentDir(studentId), path.join(dir, meta.original)), mediaType }],
        permissions: { writableGlobs: [], readableGlobs: ['submissions/**'], allowShell: false, allowNetwork: false },
      },
      Transcription,
      { signal: this.o.signal, onEvent: this.o.onEvent },
    );
    if (!r.ok) throw new Error(`Transcription failed: ${r.error}`);
    await this.o.ws.updateSubmission(studentId, subId, { text: r.value.text, meta: (m) => ({ ...m, textConfirmed: false }) }, `Transcribe ${subId}`);
    return r.value;
  }

  async confirmText(studentId: string, subId: string, text: string, prompt?: string): Promise<void> {
    await this.o.ws.updateSubmission(studentId, subId, { text, meta: (m) => ({ ...m, textConfirmed: true, prompt: prompt ?? m.prompt }) }, `Confirm text of ${subId}`);
  }

  async review(studentId: string, subId: string): Promise<StoredReview> {
    const { meta, text, dir } = await this.o.ws.readSubmission(studentId, subId);
    if (!meta.textConfirmed) throw new Error('Confirm the essay text before reviewing it.');
    if (countWords(text) < 30) throw new Error('The essay is too short to review.');
    const ctx = await buildContext(this.o.ws, studentId);
    const task = meta.kind === 'writing-task1' ? 'task1' : 'task2';
    const wordCount = countWords(text);
    const base = {
      taskType: 'review' as const,
      workspaceRoot: await this.o.ws.studentDir(studentId),
      systemAppend: systemFor(ctx.profile.goal.exam),
      model: this.o.tiers?.review ?? ('quality' as ModelTier),
      permissions: { writableGlobs: [], readableGlobs: [], allowShell: false, allowNetwork: false },
    };
    let usd = 0;
    let prompt = writingReviewPrompt({ exam: ctx.profile.goal.exam, context: ctx.text, task, taskPrompt: meta.prompt, essay: text, wordCount });
    let stored: StoredReview | undefined;
    // One content repair round on top of runStructured's schema repairs.
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await runStructured(this.o.provider, { ...base, prompt }, WritingReview, { signal: this.o.signal, onEvent: this.o.onEvent });
      usd += r.usd;
      if (!r.ok) throw new Error(`Review failed: ${r.error}`);
      const annotations: AnchoredAnnotation[] = r.value.annotations.map((a, index) => {
        const hit = locate(text, a.quote);
        return { index, ...a, start: hit?.[0] ?? null, end: hit?.[1] ?? null };
      });
      const issues = validateReview(r.value, task, annotations);
      stored = { review: r.value, annotations, wordCount, issues, usd, at: new Date().toISOString() };
      if (!issues.length) break;
      prompt = `${prompt}\n\nYour previous review had these problems; fix them:\n- ${issues.join('\n- ')}\nCopy quotes character for character from the essay.`;
    }
    await writeJson(path.join(dir, 'review.json'), stored);
    await this.o.ws.updateSubmission(studentId, subId, { meta: (m) => ({ ...m, status: 'reviewed' }) }, `Review ${subId}`);
    return stored!;
  }

  /**
   * The tutor sets final bands and accepts annotations. Only accepted annotations enter the error log,
   * and only final bands enter the profile (SPEC §4.4).
   */
  async finalise(studentId: string, subId: string, opts: { finalBands: Record<string, number>; accepted: number[] }): Promise<void> {
    const { dir, meta } = await this.o.ws.readSubmission(studentId, subId);
    const raw = await readJson(path.join(dir, 'review.json'), z.any());
    if (!raw.ok) throw new Error('No review to finalise.');
    const stored = raw.value as StoredReview;
    const date = meta.createdAt.slice(0, 10);
    const existing = new Set((await this.o.ws.readErrors(studentId)).items.map((e) => e.id));
    for (const i of opts.accepted) {
      const a = stored.annotations[i];
      if (!a || !ERROR_CODE_RE.test(a.code)) continue;
      const id = `${subId}-a${i}`;
      if (existing.has(id)) continue;
      const line = a.start === null ? '' : `#c${a.start}`;
      await this.o.ws.appendError(studentId, { id, code: a.code, excerpt: a.quote.slice(0, 200), source: `submissions/${subId}/text.md${line}`, date, status: 'open' });
    }
    await this.o.ws.updateSubmission(studentId, subId, { meta: (m) => ({ ...m, finalBands: opts.finalBands, status: 'finalised' }) });
    const today = new Date().toISOString().slice(0, 10);
    await this.o.ws.updateProfile(
      studentId,
      (p) => ({
        ...p,
        levels: [
          ...p.levels,
          ...Object.entries(opts.finalBands).map(([crit, value]) => ({ dimension: `writing.${crit}`, value, evidenceRefs: [`submissions/${subId}`], date: today })),
        ],
      }),
      `Finalise review of ${subId}`,
    );
  }
}
