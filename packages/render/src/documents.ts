import { SHORT_ITEM_TYPES, type DocMeta, type Exercise, type ExerciseItem, type HandoutDoc, type ScriptDoc, type WorksheetDoc } from '@tutordesk/core/artifacts';
import { escapeLatex as esc } from '@tutordesk/tex';
import { TexBuilder } from './builder.js';
import { hasCjk, renderInline as inl } from './inline.js';

export interface DocContext {
  studio: { name: string; monogram?: string };
  student: string;
  lessonNumber: number;
  /** Display date, e.g. "26 Oct 2026". */
  lessonDate: string;
  /** e.g. "IELTS Academic · Writing Task 2". */
  examLabel: string;
}

export interface RenderedTex {
  tex: string;
  lineMap: TexBuilder['lineMap'];
}

const DOCTYPE = { handout: 'Handout', worksheet: 'Worksheet', script: 'Lesson script' } as const;

function preamble(b: TexBuilder, kind: keyof typeof DOCTYPE, meta: DocMeta, ctx: DocContext, cjk: boolean) {
  b.line(`\\documentclass${cjk ? '[chinese]' : ''}{tutordesk}`);
  if (kind === 'script') b.line('\\usepackage{td-script}');
  b.line('\\usepackage[hidelinks]{hyperref}');
  b.line(`\\studio${ctx.studio.monogram ? `[${esc(ctx.studio.monogram)}]` : ''}{${esc(ctx.studio.name)}}`);
  b.line(`\\student{${esc(ctx.student)}}`);
  b.line(`\\lesson{${ctx.lessonNumber}}`);
  b.line(`\\lessondate{${esc(ctx.lessonDate)}}`);
  b.line(`\\doctype{${DOCTYPE[kind]}}`);
  b.line(`\\exam{${esc(ctx.examLabel).replace(/·/g, '\\textperiodcentered{}')}}`);
  b.line(`\\title{${esc(meta.title)}}`);
  if (meta.subtitle) b.line(`\\subtitle{${esc(meta.subtitle)}}`);
  if (meta.level) b.line(`\\level{${esc(meta.level)}}`);
  if (meta.timing) b.line(`\\timing{${esc(meta.timing)}}`);
  if (meta.focus) b.line(`\\focus{${esc(meta.focus)}}`);
  b.line('\\begin{document}');
  b.line('\\maketitle');
}

/* ───────────────────────── exercises ───────────────────────── */

function renderItem(b: TexBuilder, item: ExerciseItem, twoCol: boolean) {
  switch (item.type) {
    case 'mcq': {
      b.line('\\begin{question}').line(inl(item.stem)).line('\\begin{choices}');
      item.options.forEach((o, i) => b.line(`  \\choice${i === item.answer ? '*' : ''} ${inl(o)}`));
      b.line('\\end{choices}').line('\\end{question}');
      if (item.why) b.line(`\\why{${inl(item.why)}}`);
      return;
    }
    case 'tfng': {
      b.line(`\\begin{truefalse}[${item.variant}]`);
      if (twoCol) b.line('\\begin{twocol}');
      for (const s of item.statements) {
        b.line(`  \\statement{${inl(s.text)}}{${s.answer}}`);
        if (s.why) b.line(`  \\why{${inl(s.why)}}`);
      }
      if (twoCol) b.line('\\end{twocol}');
      b.line('\\end{truefalse}');
      return;
    }
    case 'gapfill': {
      if (item.title) b.line(`\\noindent{\\sffamily\\bfseries ${esc(item.title)}}`);
      b.line('\\begin{gapfill}');
      if (twoCol) b.line('\\begin{twocol}');
      b.line('\\begin{itemize}[leftmargin=1.1em,itemsep=4pt]');
      for (const l of item.lines) b.line(`  \\item ${inl(l, { gaps: true })}`);
      b.line('\\end{itemize}');
      if (twoCol) b.line('\\end{twocol}');
      b.line('\\end{gapfill}');
      return;
    }
    case 'matching': {
      b.line(`\\begin{matching}[${esc(item.title)}]`);
      for (const o of item.options) b.line(`  \\moption{${inl(o)}}`);
      for (const p of item.prompts) b.line(`  \\mitem{${inl(p.text)}}{${p.answer}}`);
      b.line('\\end{matching}');
      return;
    }
    case 'reorder': {
      b.line('\\begin{reorder}');
      for (const p of item.paragraphs) b.line(`  \\para{${p.position}}{${inl(p.text)}}`);
      b.line('\\end{reorder}');
      return;
    }
    case 'dictation':
      for (const s of item.sentences) b.line(`\\writeline{${esc(s)}}`);
      return;
    case 'short':
      b.line('\\begin{question}').line(inl(item.prompt)).line(`\\writeline{${esc(item.model)}}`).line('\\end{question}');
      return;
    case 'passage': {
      b.line(`\\begin{passage}${item.title ? `[${esc(item.title)}]` : '[]'}${item.note ? `[${esc(item.note)}]` : ''}`);
      item.paragraphs.forEach((p, i) => {
        if (i) b.line('');
        b.line(`${p.label ? `\\plabel{${esc(p.label)}}` : ''}${inl(p.text)}`);
      });
      b.line('\\end{passage}');
      return;
    }
    case 'writing':
      b.line(`\\noindent\\emph{${inl(item.prompt)}}`).line('').line(`\\answerlines{${item.lines}}`);
      if (item.model) b.line('\\begin{solution}[Model]').line(inl(item.model)).line('\\end{solution}');
      return;
    case 'wordbank':
      b.line(`\\wordbank${item.title ? `[${esc(item.title)}]` : ''}{${item.words.map(esc).join(', ')}}`);
      return;
    case 'cuecard':
      b.line(`\\begin{cuecard}${item.title ? `[${esc(item.title)}]` : ''}{${inl(item.task)}}`);
      for (const c of item.cues) b.line(`  \\item ${inl(c)}`);
      b.line(`  \\andexplain{${inl(item.explain)}}`);
      if (item.note) b.line(`  \\cuenote{${inl(item.note)}}`);
      b.line('\\end{cuecard}');
      return;
  }
}

/** Items that manage their own columns, or must stay full width, break any open twocol run. */
const SELF_COLUMNED = new Set<ExerciseItem['type']>(['tfng', 'gapfill']);

export function renderExercise(b: TexBuilder, ex: Exercise) {
  b.node(ex.id, () => {
    // Keep the heading with its first items rather than stranded at the foot of a page.
    b.line('\\needspace{0.3\\textheight}');
    b.line(`\\begin{exercise}${ex.tag ? `[tag=${esc(ex.tag)}]` : ''}{${esc(ex.title)}}`);
    if (ex.instructions) b.line(`\\instructions{${inl(ex.instructions)}}`);
    let open = false;
    for (const item of ex.items) {
      const groupable = ex.twoColumn && SHORT_ITEM_TYPES.has(item.type) && !SELF_COLUMNED.has(item.type);
      if (groupable && !open) {
        // A column run that starts near the foot of a page splits badly; move it to the next page instead.
        b.line('\\needspace{0.25\\textheight}');
        b.line('\\begin{twocol}');
        open = true;
      } else if (!groupable && open) {
        b.line('\\end{twocol}');
        open = false;
      }
      b.node(item.id, () => renderItem(b, item, ex.twoColumn && SELF_COLUMNED.has(item.type)), false);
    }
    if (open) b.line('\\end{twocol}');
    b.line('\\end{exercise}');
  });
}

/* ───────────────────────── documents ───────────────────────── */

export function renderWorksheet(doc: WorksheetDoc, ctx: DocContext): RenderedTex {
  const b = new TexBuilder();
  preamble(b, 'worksheet', doc.meta, ctx, hasCjk(JSON.stringify(doc)));
  for (const ex of doc.exercises) {
    renderExercise(b, ex);
    b.line('');
  }
  b.line('\\printanswers').line('\\end{document}');
  return { tex: b.toString(), lineMap: b.lineMap };
}

export function renderHandout(doc: HandoutDoc, ctx: DocContext): RenderedTex {
  const b = new TexBuilder();
  preamble(b, 'handout', doc.meta, ctx, hasCjk(JSON.stringify(doc)));
  for (const block of doc.blocks) {
    if (block.type === 'exercise') {
      renderExercise(b, block.exercise);
      continue;
    }
    b.node(block.id, () => {
      switch (block.type) {
        case 'objectives':
          b.line(`\\begin{objectives}${block.lead ? `[${esc(block.lead)}]` : ''}`);
          for (const i of block.items) b.line(`  \\item ${inl(i)}`);
          b.line('\\end{objectives}');
          break;
        case 'section':
          b.line(`\\section{${esc(block.title)}}`);
          break;
        case 'paragraph':
          b.line(inl(block.text)).line('');
          break;
        case 'keypoint':
          b.line(`\\begin{keypoint}${block.title ? `[${esc(block.title)}]` : ''}`).line(inl(block.text)).line('\\end{keypoint}');
          break;
        case 'compare': {
          b.line('\\begin{compare}');
          b.line(`\\begin{example}${block.good.label ? `[${esc(block.good.label)}]` : ''}`);
          b.line(block.good.segments.map((s) => `${s.tag ? `\\seg{${esc(s.tag)}}` : ''}${inl(s.text)}`).join(' '));
          b.line('\\end{example}');
          b.line(`\\begin{nonexample}${block.weak.label ? `[${esc(block.weak.label)}]` : ''}`).line(inl(block.weak.text)).line('\\end{nonexample}');
          b.line('\\end{compare}');
          if (block.question) b.line(`\\noindent\\emph{${inl(block.question)}}`).line('');
          break;
        }
        case 'vocab':
          b.line('\\begin{vocab}');
          for (const e of block.entries) {
            b.line(`  \\chunk${e.ipa ? `[${esc(e.ipa)}]` : ''}{${esc(e.phrase)}}{${inl(e.pattern)}}{${inl(e.example)}}`);
          }
          b.line('\\end{vocab}');
          break;
        case 'selfcheck':
          b.line(`\\begin{selfcheck}${block.title ? `[${esc(block.title)}]` : ''}`);
          for (const i of block.items) b.line(`  \\item ${inl(i)}`);
          b.line('\\end{selfcheck}');
          break;
        case 'teachernote':
          b.line(`\\begin{teachernote}${block.title ? `[${esc(block.title)}]` : ''}`).line(inl(block.text)).line('\\end{teachernote}');
          break;
      }
    });
  }
  b.line('\\printanswers').line('\\end{document}');
  return { tex: b.toString(), lineMap: b.lineMap };
}

export function renderScript(doc: ScriptDoc, ctx: DocContext): RenderedTex {
  const b = new TexBuilder();
  preamble(b, 'script', doc.meta, ctx, hasCjk(JSON.stringify(doc)));
  b.line('\\runningorder');
  if (doc.materials.length) {
    b.line('\\begin{materials}');
    for (const m of doc.materials) b.line(`  \\item ${inl(m)}`);
    b.line('\\end{materials}');
  }
  for (const st of doc.stages) {
    b.node(st.id, () => {
      b.line(`\\stage{${st.minutes}}{${esc(st.title)}}${st.aim ? `[${inl(st.aim)}]` : ''}`);
      for (const s of st.steps) {
        switch (s.type) {
          case 'say':
            b.line('\\begin{say}').line(inl(s.text, { beats: true })).line('\\end{say}');
            break;
          case 'expect':
          case 'probe':
          case 'action':
            b.line(`\\begin{${s.type}}`);
            for (const i of s.items) b.line(`  \\item ${inl(i)}`);
            b.line(`\\end{${s.type}}`);
            break;
          case 'board':
            b.line('\\begin{board}').line(inl(s.text)).line('\\end{board}');
            break;
          case 'fallback':
            b.line(`\\begin{fallback}{${inl(s.condition)}}`).line(inl(s.text)).line('\\end{fallback}');
            break;
        }
      }
    });
  }
  b.line('\\end{document}');
  return { tex: b.toString(), lineMap: b.lineMap };
}
