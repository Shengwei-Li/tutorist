import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ARTIFACT_SCHEMAS, LessonPlan, RubricReview, WritingReview } from '@tutordesk/core/artifacts';
import { TexEngine, detectSystemTex } from '@tutordesk/tex';
import { BEAMER_THEME_NAMES, plainText, renderDeck, renderHandout, renderInline, renderScript, renderWorksheet, type DocContext } from '../src/index.js';
import { deck, handout, script, worksheet } from './fixtures/docs.js';

const TEMPLATES = fileURLToPath(new URL('../../../workspace-template/templates/tex/', import.meta.url));
const ctx: DocContext = { studio: { name: 'Northbridge English Studio', monogram: 'NE' }, student: 'Mina Park', lessonNumber: 3, lessonDate: '28 Oct 2026', examLabel: 'IELTS Academic · Writing Task 2' };
const deckCtx = { theme: 'tutorswiss' as const, learner: 'Mina Park', tutor: 'Lin Chen', lessonNumber: 3 };

describe('renderInline', () => {
  it('escapes text and converts allowed markup only', () => {
    expect(renderInline('50% of *A & B* {{position|立场}} [[ipa:/dɪˈtɜː/]]')).toBe('50\\% of \\emph{A \\& B} \\gloss{position}{立场} \\ipa{/dɪˈtɜː/}');
    expect(renderInline('Meet at [[gap:8.30]]')).toBe('Meet at 8.30');
    expect(renderInline('Meet at [[gap:8.30]]', { gaps: true })).toBe('Meet at \\gap{8.30}');
    expect(renderInline('x [[err:have]] y', { deck: true })).toBe('x \\err{have} y');
    expect(renderInline('pause || here', { beats: true })).toBe('pause \\beat{} here');
    expect(renderInline('\\input{/etc/passwd}')).toBe('\\textbackslash{}input\\{/etc/passwd\\}');
    expect(plainText('*a* {{b|c}} [[gap:d]]')).toBe('a b d');
  });
});

describe('schemas', () => {
  it('fixtures validate and every schema converts to JSON Schema', () => {
    for (const [kind, doc] of Object.entries({ handout, worksheet, script, deck })) {
      const r = ARTIFACT_SCHEMAS[kind as keyof typeof ARTIFACT_SCHEMAS].safeParse(doc);
      expect(r.success, `${kind}: ${r.error?.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`).toBe(true);
    }
    for (const s of [...Object.values(ARTIFACT_SCHEMAS), LessonPlan, WritingReview, RubricReview]) {
      const js = z.toJSONSchema(s, { target: 'draft-7' }) as { type?: string };
      expect(js.type).toBe('object');
    }
  });
});

describe('renderers', () => {
  it('keeps long items out of two-column runs', () => {
    const { tex } = renderWorksheet(worksheet, ctx);
    const passageAt = tex.indexOf('\\begin{passage}');
    const before = tex.slice(0, passageAt);
    expect(before.lastIndexOf('\\begin{twocol}')).toBeLessThanOrEqual(before.lastIndexOf('\\end{twocol}'));
    const writing = tex.slice(tex.indexOf('Outline a new question'));
    expect(writing).not.toContain('\\begin{twocol}');
    expect(tex).toContain('\\choice* significant');
    expect(tex).toContain('\\statement{Footfall increased in some cities.}{TRUE}');
  });

  it('maps node ids to line ranges', () => {
    const { tex, lineMap } = renderHandout(handout, ctx);
    const lines = tex.split('\n');
    const cmp = lineMap.find((m) => m.nodeId === 'cmp1')!;
    expect(lines.slice(cmp.fromLine - 1, cmp.toLine).join('\n')).toContain('\\begin{compare}');
    expect(tex.startsWith('\\documentclass[chinese]{tutordesk}')).toBe(true);
  });
});

const tex = await detectSystemTex({ skipPackageCheck: true });

describe.skipIf(!tex)('rendered artifacts compile with XeLaTeX', () => {
  const engine = new TexEngine({ maxConcurrent: 3 });
  const outDir = path.join(os.tmpdir(), 'tutordesk-render-test');

  const compile = async (name: string, r: { tex: string; lineMap: { fromLine: number; toLine: number; nodeId: string }[] }, pretex?: string) => {
    const res = await engine.compile({ mainTex: r.tex, lineMap: r.lineMap, templateDir: TEMPLATES, pretex });
    await mkdir(outDir, { recursive: true });
    if (res.pdf) await writeFile(path.join(outDir, `${name}.pdf`), res.pdf);
    const errors = res.errors.filter((e) => e.severity === 'error');
    expect(errors, `${name}\n${res.log.slice(-2000)}`).toEqual([]);
    expect(res.ok).toBe(true);
    return res;
  };

  it('handout: student and teacher', async () => {
    const r = renderHandout(handout, ctx);
    await compile('handout-student', r);
    await compile('handout-teacher', r, '\\def\\TDmode{teacher}');
  }, 120_000);

  it('worksheet: student, teacher and key', async () => {
    const r = renderWorksheet(worksheet, ctx);
    await Promise.all([compile('worksheet-student', r), compile('worksheet-teacher', r, '\\def\\TDmode{teacher}'), compile('worksheet-key', r, '\\def\\TDmode{key}')]);
  }, 180_000);

  it('lesson script', async () => {
    await compile('script', renderScript(script, ctx));
  }, 120_000);

  it('deck in every theme', async () => {
    await Promise.all(BEAMER_THEME_NAMES.map((theme) => compile(`deck-${theme}`, renderDeck(deck, { ...deckCtx, theme }))));
  }, 240_000);
});
