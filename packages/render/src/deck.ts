import type { DeckBlock, DeckDoc } from '@tutordesk/core/artifacts';
import { escapeLatex as esc } from '@tutordesk/tex';
import { TexBuilder } from './builder.js';
import type { RenderedTex } from './documents.js';
import { renderInline } from './inline.js';

export const BEAMER_THEME_NAMES = ['tutorswiss', 'tutorbook', 'tutorsheet', 'tutorfocus'] as const;
export type BeamerThemeName = (typeof BEAMER_THEME_NAMES)[number];

export interface DeckContext {
  theme: BeamerThemeName;
  learner: string;
  tutor: string;
  lessonNumber: number;
}

const inl = (t: string) => renderInline(t, { deck: true });

function block(b: TexBuilder, blk: DeckBlock) {
  switch (blk.type) {
    case 'objectives':
      b.line('  \\begin{objectives}');
      for (const i of blk.items) b.line(`    \\item ${inl(i)}`);
      b.line('  \\end{objectives}');
      if (blk.bandFocus) b.line(`  \\bandfocus{${esc(blk.bandFocus)}}`);
      return;
    case 'compare':
      b.line('  \\begin{compare}');
      b.line(`    \\original{${inl(blk.original)}}`);
      b.line(`    \\revised{${inl(blk.revised)}}`);
      for (const n of blk.notes) b.line(`    \\why{${inl(n)}}`);
      b.line('  \\end{compare}');
      return;
    case 'peel':
      b.line(`  \\peel{${inl(blk.point)}}{${inl(blk.explain)}}{${inl(blk.example)}}{${inl(blk.link)}}`);
      return;
    case 'flow':
      b.line(`  \\begin{flow}${blk.returnLabel ? `[${esc(blk.returnLabel)}]` : ''}`);
      for (const s of blk.steps) b.line(`    \\flowstep{${esc(s.key)}}{${esc(s.name)}}{${inl(s.text)}}`);
      b.line('  \\end{flow}');
      return;
    case 'cuecard':
      b.line(`  \\begin{cuecard}${blk.title ? `[${esc(blk.title)}]` : ''}{${inl(blk.task)}}`);
      for (const c of blk.cues) b.line(`    \\cue{${inl(c)}}`);
      b.line(`    \\cueexplain{${inl(blk.explain)}}`);
      if (blk.timing) b.line(`    \\cuetiming{${esc(blk.timing)}}`);
      b.line('  \\end{cuecard}');
      return;
    case 'taskcard':
      b.line(`  \\begin{taskcard}${blk.title ? `[${esc(blk.title)}]` : ''}`).line(`    ${inl(blk.text)}`).line('  \\end{taskcard}');
      return;
    case 'timed':
      b.line(`  \\begin{timed}${blk.caption ? `[${esc(blk.caption)}]` : ''}{${blk.time}}`);
      b.line(`    \\prompt{${inl(blk.prompt)}}`);
      if (blk.phases.length) {
        b.line('    \\begin{phases}');
        for (const p of blk.phases) b.line(`      \\phase{${esc(p.time)}}{${inl(p.text)}}`);
        b.line('    \\end{phases}');
      }
      b.line('  \\end{timed}');
      return;
    case 'reveal':
      b.line('  \\begin{reveal}');
      for (const s of blk.steps) b.line(`    \\step${s.note ? `[${esc(s.note)}]` : ''}{${esc(s.label)}}{${inl(s.text)}}`);
      b.line('  \\end{reveal}');
      return;
    case 'bullets':
      b.line('  \\begin{itemize}');
      for (const i of blk.items) b.line(`    \\item ${inl(i)}`);
      b.line('  \\end{itemize}');
      return;
    case 'wrapup':
      b.line('  \\begin{columns}[T,onlytextwidth]').line('    \\column{0.45\\linewidth}');
      if (blk.summary.length) {
        b.line('      \\begin{summary}');
        for (const s of blk.summary) b.line(`        \\item ${inl(s)}`);
        b.line('      \\end{summary}');
      }
      if (blk.words.length) {
        b.line('      \\begin{wordlist}');
        for (const w of blk.words) b.line(`        \\vocab{${esc(w.word)}}{${esc(w.ipa.replace(/^\/|\/$/g, ''))}}{${esc(w.gloss)}}`);
        b.line('      \\end{wordlist}');
      }
      b.line('    \\column{0.49\\linewidth}').line('      \\begin{exitcheck}');
      for (const q of blk.exit) b.line(`        \\item ${inl(q)}`);
      b.line('      \\end{exitcheck}').line('  \\end{columns}');
      return;
  }
}

export function renderDeck(doc: DeckDoc, ctx: DeckContext): RenderedTex {
  const b = new TexBuilder();
  const m = doc.meta;
  b.line('\\documentclass[aspectratio=169,10pt]{beamer}');
  b.line(`\\usetheme{${ctx.theme}}`);
  b.line(`\\title{${esc(m.title)}}`);
  if (m.subtitle) b.line(`\\subtitle{${esc(m.subtitle)}}`);
  b.line(`\\author{${esc(ctx.tutor)}}`);
  b.line(`\\examtag{${esc(m.examTag).replace(/·/g, '\\textperiodcentered{}')}}`);
  b.line(`\\lessonlabel{Lesson ${ctx.lessonNumber}}`);
  if (m.duration) b.line(`\\duration{${esc(m.duration)}}`);
  if (m.target) b.line(`\\target{${esc(m.target)}}`);
  b.line(`\\learner{${esc(ctx.learner)}}`);
  b.line('\\date{}').line('\\begin{document}').line('\\titleslide');
  for (const f of doc.frames) {
    b.node(
      f.id,
      () => {
        b.line('');
        if (f.type === 'keyframe') {
          b.line(`\\keyframe${f.label ? `[${esc(f.label)}]` : ''}{${inl(f.text)}}`);
          return;
        }
        const opts = [`label=${f.id.replace(/[^A-Za-z0-9-]/g, '-')}`, f.stage ? `stage=${esc(f.stage)}` : ''].filter(Boolean).join(',');
        b.line(`\\begin{frame}[${opts}]{${esc(f.title)}}`);
        for (const blk of f.blocks) block(b, blk);
        if (f.aside) b.line(`  \\aside{${inl(f.aside)}}`);
        b.line('\\end{frame}');
      },
      false,
    );
  }
  b.line('\\end{document}');
  return { tex: b.toString(), lineMap: b.lineMap };
}
