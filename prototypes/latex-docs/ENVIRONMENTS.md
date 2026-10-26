# TutorDesk LaTeX: semantic environments

This file is the reference for AI prompts that generate TutorDesk materials.
**The model writes content only.** It never sets fonts, colours, sizes, spacing,
boxes or column widths: every visual decision lives in `tutordesk.cls`,
`td-exercises.sty` and `td-script.sty`.

Engine: **XeLaTeX only** (Tectonic-compatible). Fonts are loaded by file from
`fonts/` (relative to the directory you compile in), never by system name.

## Hard rules for generated content

1. Use only the commands in this file, plus plain text, `\emph{}`, `\section{}`,
   `\subsection{}`, `itemize` and `enumerate`.
2. **One emphasis style per page:** use `\emph{}` only. Do not use `\textbf`,
   underline, colour or capitals for emphasis. (Exam rubric capitals such as
   `ONE WORD AND/OR A NUMBER` are rubric, not emphasis.)
3. Glosses and annotations go **next to the text they explain**: use `\gloss`
   or `\sidegloss`, never `\footnote`.
4. **Two columns only for short items:** MCQ, gap-fill notes, TFNG statements,
   matching prompts, Write From Dictation, vocabulary, error correction. Reading
   passages, model essays and essay or summary answer lines stay single-column
   and full-width (outside `twocol`).
5. Every auto-gradable item takes its answer as an argument. Never print
   answers yourself: the class shows them in the teacher edition and collects
   them into the answer key.
6. Refer to the student as *they/them*. Write original texts; do not copy
   published exam material.

## Document skeleton

```latex
\documentclass{tutordesk}            % options: chinese, inlineanswers
% \usepackage{td-script}             % only for lesson scripts
\studio[NE]{Northbridge English Studio}   % [monogram used as logo placeholder]
% \logo{path/to/logo.pdf}            % replaces the placeholder
\student{Mina Park}
\lesson{7}
\lessondate{26 Oct 2026}
\doctype{Worksheet}                  % Handout | Worksheet | Lesson script
\exam{IELTS Academic \textperiodcentered{} Writing Task 2}
\title{...}
\subtitle{...}                       % optional
\level{Band 6.0 to 7.0}              % optional, each one hidden when omitted
\timing{60 min}
\focus{Task Response}
\begin{document}
\maketitle
...
\printanswers                        % answer key on a new page (teacher/key mode only)
\end{document}
```

## Modes: one switch, three outputs

| Mode | Shows | How |
|---|---|---|
| `student` (default) | questions only; `teachernote` and answers hidden | — |
| `teacher` | answers filled in place, `teachernote`, answer key on a new page, "Teacher's edition" marked in the title and footer | `\documentclass[teacher]{tutordesk}` |
| `key` | **only** the answer key (body is typeset for numbering, then discarded) | `\documentclass[key]{tutordesk}` |

The same source builds every mode from the command line:

```bash
latexmk -usepretex="\def\TDmode{teacher}" -jobname=worksheet-teacher worksheet.tex
```
`build.sh` builds all samples in all modes and renders PNGs.

Option `inlineanswers` (teacher mode) also prints each `solution` in place.
Option `chinese` loads xeCJK with Fandol Song/Hei from `fonts/` (needed for
Chinese in `\gloss`).

---

## Handout environments (tutordesk.cls)

### `objectives`
```latex
\begin{objectives}[By the end of this lesson, you will be able to:]  % optional lead-in
  \item write a first sentence that makes one clear claim;
  \item ...
\end{objectives}
```

### `keypoint`
One rule worth remembering. An accent rule above and a hairline below; no box.
```latex
\begin{keypoint}[Explain before you exemplify]   % optional title
Text of the key point.
\end{keypoint}
```

### `example` / `nonexample` / `compare`
Effective and less effective models. In black and white the difference is still
carried three ways: ✓ vs ✗, a solid vs a dashed rule, and the label text.
```latex
\begin{compare}                       % optional: puts the two side by side
\begin{example}[Effective \textperiodcentered{} Band 7 range]   % default "Effective"
\seg{P}Point sentence. \seg{Ex}Explanation. \seg{Eg}Example. \seg{L}Link.
\end{example}
\begin{nonexample}[Less effective]    % default "Less effective"
Weak text.
\end{nonexample}
\end{compare}
```
`\seg{label}` puts a small framed label before a segment of a model text.

### `vocab` and `\chunk`
```latex
\begin{vocab}[Chunk][Pattern and example]          % optional column heads
  \chunk{this is largely because}{claim + \emph{this is largely because} + clause}%
        {Rents have risen. This is largely because supply has not kept pace.}
  \chunk[/ˌdɪs.prəˈpɔː.ʃən.ət.li/]{hit someone disproportionately hard}%
        {verb + adverb}{Price rises hit low-income families disproportionately hard.}
\end{vocab}
```
Syntax is `\chunk[IPA]{phrase}{pattern or gloss}{example sentence}`. The IPA
argument is optional. Entries never split across pages.

### Glosses and IPA
| Command | Result |
|---|---|
| `\gloss{truism}{不言自明的道理}` | the note is set in small type directly under the word (interlinear) |
| `\sidegloss{note}` | at the end of a line or paragraph: the note is set flush right on that line |
| `\ipa{/ˈθʌr.əʊ/}` | Charis SIL IPA |
| `\enquote{text}` | curly double quotes |
| `\headlabel{text}` | small letter-spaced column head for tables |

### `selfcheck`
```latex
\begin{selfcheck}[Check your own paragraph]    % default "Self-check"
  \item My first sentence makes one claim.
\end{selfcheck}
```

### `teachernote`
Shown only in teacher and key modes; removed entirely from the student copy.
```latex
\begin{teachernote}[Audio script]   % default label "Teacher note"
Text for the tutor only.
\end{teachernote}
```

### `solution` and `\why`
```latex
\begin{solution}[Plan]  % optional label; inside a question the default label is its number
Model answer text.
\end{solution}
\why{Para B: ``pump warm air back into the street''.}   % explanation added to the previous key entry
```

### `\printanswers[Answer key]`
Put it at the end of the document. In student mode it prints nothing. In
teacher mode it starts a new page and sets the collected answers in two columns,
grouped by exercise with question ranges. In key mode it is the only output.

---

## Exercise environments (td-exercises.sty, loaded automatically)

Question numbers run continuously through the document, as on IELTS papers.
Each exercise heading shows the range automatically, for example
"Questions 1–5"; the ranges appear after the second LaTeX run.

### `exercise`
```latex
\begin{exercise}[tag=IELTS Reading, columns=2]{True, False or Not Given}
  ...
\end{exercise}
```
`tag` is the small label on the right. `columns=2` puts the whole body in two
columns; use it only when the body is all short items.

### `\instructions{...}`
The rubric line, set in italic.

### `passage`
Always single-column. `\plabel{A}` sets a paragraph letter in the left rail.
```latex
\begin{passage}[Cooling the City][Practice text written for this worksheet.]
\plabel{A}First paragraph...

\plabel{B}Second paragraph...
\end{passage}
```

### `twocol`
```latex
\begin{twocol}  ...short items...  \end{twocol}   % [3] for three columns
```
Close it before any passage or long answer lines.

### `question`
A numbered item. It never splits across columns or pages.
```latex
\begin{question}
Which sentence works best as the Point?
\begin{choices}
  \choice Sugary drinks are popular.
  \choice* A tax would cut consumption among children.   % * = correct
  \choice Many people have opinions.
  \choice Sugar is bad for you.
\end{choices}
\end{question}
```
`choices[n]` forces 1, 2 or 4 columns. Without it the layout is chosen from the
longest option: 4 across, 2×2, or stacked. In the teacher edition the correct
letter is reversed out of an accent square, so it reads in black and white too.

### Gaps and blanks
| Command | Use |
|---|---|
| `\gap[width]{answer}` | numbered gap (IELTS notes, PTE FIB); counts as a question |
| `\blank[width]{answer}` | unnumbered blank; not collected |
| `\writeline[space]{model}` | numbered full-width writing line (Write From Dictation, sentence rewrites) |
| `\answerlines[gap]{n}` | n ruled lines (default gap 8.5 mm); lines are numbered every 5 when n ≥ 10; may break across pages |
| `\wordbank[title]{w1, w2, ...}` | framed word box for drag-and-drop FIB |

Wrap prose that contains gaps in `gapfill`, which gives taller lines for
handwriting:
```latex
\begin{gapfill}
The brain appears to \gap{consolidate} recent experiences ...
\end{gapfill}
```

### `truefalse` / `\statement`
```latex
\begin{truefalse}[TFNG]        % TFNG | YNNG | TF ; prints the standard legend
\begin{twocol}
  \statement{Cities receive more sunlight.}{FALSE}
  \why{Para A: ...}
\end{twocol}
\end{truefalse}
```

### `matching`
```latex
\begin{matching}[People]                  % title of the options box
  \moption{Dr Ines Varga, urban climatologist}   % lettered A, B, C... in order
  \moption{Tomás Reyes, landscape architect}
  \mitem{Suppliers understate the full cost.}{B}  % prompt, correct letter
\end{matching}
```

### `reorder` (PTE Re-order Paragraphs)
```latex
\begin{reorder}
  \para{4}{Text shown as A ...}   % {correct position}{text}; shown in the order written
  \para{2}{Text shown as B ...}
\end{reorder}
```
This prints lettered boxes and a "Correct order" row; the key reads
`D → B → E → A → C`. The whole block counts as one question.

### `cuecard` (IELTS Speaking Part 2)
```latex
\begin{cuecard}[Speaking Part 2]{Describe a public place in your town that you think is important.}
  \item where it is
  \item who uses it
  \andexplain{and explain why you think it is important.}
  \cuenote{One minute to prepare, then speak for up to two minutes.}
\end{cuecard}
```

---

## Lesson script (td-script.sty)

Load it with `\usepackage{td-script}`. A left rail holds the clock time and cue
labels. The typography separates voices:

| Voice | Style |
|---|---|
| teacher says | roman serif, 11 pt |
| student expected to say | italic |
| directions and contingencies | sans |

| Command / environment | Rail label | Use |
|---|---|---|
| `\runningorder` | — | timetable built from the stages: clock, minutes, stage, page; total shown under it |
| `\stage{minutes}{title}[aim]` | clock h:mm | starts a stage; the clock accumulates automatically |
| `say` | SAY | verbatim teacher talk; `\beat` inserts a pause mark |
| `expect` (`\item`) | EXPECT | likely student answers |
| `probe` (`\item`) | PROBE | follow-up questions |
| `action` (`\item`) | DO | stage directions |
| `fallback{condition}` | IF | plan B, e.g. `\begin{fallback}{If they finish early}` |
| `board` | BOARD | what to write on the board (framed) |
| `materials` (`\item`) | — | materials list |

```latex
\stage{10}{Diagnose: the weak paragraph}[They find the missing moves themselves.]
\begin{say}
Read the second paragraph. \beat Which sentence answers the question?
\end{say}
\begin{expect}
  \item None of them really.
\end{expect}
\begin{fallback}{If they defend the weak paragraph}
Agree the opinion is clear, then ask why.
\end{fallback}
```

## Build

```bash
./build.sh            # hot: reuses build/ aux files
./build.sh --cold     # removes build/ first
```
Outputs go to `<name>-<mode>.pdf` beside the sources and to `png/<name>-<mode>-N.png` at 70 dpi.
