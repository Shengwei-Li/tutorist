# Semantic macros for tutor decks (IELTS / PTE)

Content files (`*.tex` written by people or by the AI) use **only** the macros on this page.
They never set colours, fonts, sizes, spacing or TikZ styles. A theme decides how everything looks,
so switching style means changing one line:

```latex
\documentclass[aspectratio=169,10pt]{beamer}   % fixed for every deck
\usetheme{tutorswiss}    % or tutorbook | tutorfocus | tutorsheet
\input{lesson-peel}      % or the lesson body itself
```

Engine: **XeLaTeX only** (Tectonic-compatible; nothing here depends on LuaLaTeX).
Fonts are loaded with fontspec `Path=../fonts/`, and that path is resolved **relative to the
directory you compile in**, so each deck must be compiled from a folder that sits next to `fonts/`
(the style folders already do this). The semantic layer lives in `common/tutorlesson.sty`. Each
style folder has a `latexmkrc` that adds `../common` to `TEXINPUTS`.

---

## 1. Lesson metadata (preamble)

| Macro | Example | Used by |
|---|---|---|
| `\title{…}` / `\subtitle{…}` | `\title{Building a body paragraph with PEEL}` | title slide, running heads |
| `\author{…}` | `\author{Lin Chen}` (the tutor) | title slide |
| `\examtag{…}` | `\examtag{IELTS Academic \textperiodcentered{} Writing Task 2}` | title slide, header/footer |
| `\lessonlabel{…}` | `\lessonlabel{Lesson 7}` | title slide, footer |
| `\duration{…}` | `\duration{60 min}` | title slide |
| `\target{…}` | `\target{Band 6.0 to 6.5}` | title slide |
| `\learner{…}` | `\learner{Jordan}` | title slide, sheet header |
| `\date{}` | leave empty | — |

## 2. Slides

| Macro | Purpose |
|---|---|
| `\titleslide` | The title slide. Takes no arguments; uses the metadata above. |
| `\begin{frame}[stage=Diagnose]{Title} … \end{frame}` | An ordinary slide. `stage=` is optional and names the lesson phase (Goals, Diagnose, Structure, Model, Practise, Wrap-up …). Keep titles under ~40 characters. |
| `\keyframe[label]{text}` | A whole slide that shows one sentence (rule of thumb, key takeaway). Use `\\` for a deliberate line break. Do **not** wrap it in a frame. |

Standard beamer that content may still use: `itemize`, `enumerate`, `\pause`, `<+->`, `\only<…>`,
`columns`/`\column{0.48\linewidth}` (for side-by-side blocks, e.g. summary + exit check), `\emph`.
Nothing else: no `\color`, `\textcolor`, `\fontsize`, `\vspace`, `\hspace`, `tikzpicture`, `\includegraphics` (until an image macro exists).

## 3. Content blocks

### Objectives
```latex
\begin{objectives}[optional label]       % default label: "By the end of this lesson, you can"
  \item Name the four PEEL moves and what each one does.
  \item …                                % 2–4 items, one line each if possible
\end{objectives}
\bandfocus{Task Response \textperiodcentered{} Coherence and Cohesion}   % optional
```

### Student sentence vs revision
```latex
\begin{compare}
  \original[optional label]{Nowadays, many people \err{thinks} that …}
  \revised[optional label]{… one clear advantage: it \fix{has} …}
  \why{\emph{many people think}: plural subject, plural verb}   % note 1 ↔ first \err
  \why{…}                                                        % note 2 ↔ second \err
\end{compare}
```
* `\err{…}` marks an error with a wavy underline and an automatic superscript number (1, 2, 3 …).
* `\fix{…}` marks the corrected wording with a solid underline.
* `\why{…}` adds one short numbered note (keep each under ~8 words). Notes are numbered in order, so write them in the same order as the `\err` marks. Up to 4 notes fit.
* Errors are never shown with red/green fills: wavy versus solid underline carries the meaning in every theme, including grey-scale print.

### Structure diagram
```latex
\peel{Point text}{Explain text}{Example text}{Link text}   % fixed PEEL labels, return arrow

\begin{flow}[optional return-arrow label]                    % any 3–5 step structure
  \flowstep{P}{Point}{State one clear claim.}
  \flowstep{E}{Explain}{Give the reason.}
  …
\end{flow}
```
`\flowstep{key}{name}{description}`: key is 1–2 characters, description at most ~10 words.
Use `flow` for other templates, e.g. PTE Describe Image (`\flowstep{1}{Overview}{…}`).

### Task cards
```latex
\begin{cuecard}[IELTS Speaking \textperiodcentered{} Part 2]{Describe a subject you studied …}
  \cue{what the subject was}
  \cue{when and where you studied it}
  \cue{what you learned from it}
  \cueexplain{and explain whether you think it was worth studying.}
  \cuetiming{1 min to prepare \textperiodcentered{} 1--2 min to speak}   % optional
\end{cuecard}

\begin{taskcard}[PTE Speaking \textperiodcentered{} Describe Image]
  Look at the graph below. In 25 seconds, please speak into the microphone …
\end{taskcard}
```

### Timed practice
```latex
\begin{timed}[optional caption]{8:00}       % caption default: "countdown"
  \prompt{Some people believe that …? To what extent do you agree or disagree?}
  \begin{phases}
    \phase{0--1 min}{Plan: choose one Point and one example.}
    \phase{1--6 min}{Write 120--150 words in PEEL order.}
    \phase{6--8 min}{Check verb agreement, articles and the Link.}
  \end{phases}
\end{timed}
```
`\timer{3 min}` is the inline form (small drawn stopwatch + time) for use in any sentence.

### Step-by-step reveal (overlays)
```latex
\begin{reveal}
  \step[optional note shown only while this step is current]{Point}{Sentence text.}
  \step[…]{Explain}{…}
\end{reveal}
```
Each `\step` appears on its own click. The current step is in full ink with an accent label;
earlier steps fade to a secondary tone; the note appears only with its own step. 3–5 steps.

### Wrap-up
```latex
\begin{columns}[T,onlytextwidth]
  \column{0.45\linewidth}
    \begin{summary}[optional label]        % default "Today"
      \item A Point makes one specific claim.
    \end{summary}
    \begin{wordlist}[optional label]       % default "Words to reuse"
      \vocab{transferable}{trænsˈfɜːrəbl}{useful in many situations}
    \end{wordlist}
  \column{0.49\linewidth}
    \begin{exitcheck}[optional label]      % default "Exit check"
      \item Correct this sentence: \sample{It have many advantage.}
    \end{exitcheck}
\end{columns}
```
The worksheet theme adds a dotted writing line under each exit question so the student can
answer on the PDF with a stylus; other themes leave it out. No change to the content is needed.

### Inline helpers
| Macro | Purpose |
|---|---|
| `\sample{…}` | Quoted learner or model language (adds typographic quotes). |
| `\ipa{…}` | IPA in a font that has the glyphs (Inter, Charis SIL or Noto Sans, depending on theme). Type the symbols directly in UTF-8; the slashes are up to you. `\vocab` adds slashes for you. |
| `\aside{…}` | One quiet sentence under a block: a teaching tip or what the student does next. One per slide at most. |
| `\emph{…}` | Normal emphasis. |

---

## 4. Content budget per slide (16:9, 10 pt)

These limits keep every theme free of overflow; the AI generator should enforce them.

| Block | Budget |
|---|---|
| Frame title | ≤ 40 characters |
| `objectives` | 2–4 items, ≤ 70 characters each |
| `compare` | original and revised ≤ 160 characters each, ≤ 4 `\why` notes of ≤ 60 characters |
| `peel` / `flow` | ≤ 5 steps, description ≤ 60 characters |
| `cuecard` | task ≤ 90 characters, 3–4 cues, plus one `\cueexplain` |
| `timed` | prompt ≤ 220 characters, ≤ 3 phases |
| `reveal` | ≤ 4 steps of ≤ 180 characters; notes ≤ 50 characters |
| wrap-up | ≤ 3 summary items, ≤ 2 words, ≤ 3 exit questions |
| `\aside` | ≤ 110 characters |

---

## 5. For theme authors (not for content)

A theme is `beamertheme<name>.sty`. It must:

1. `\definecolor` the palette **before** `\RequirePackage{tutorlesson}`:
   `tutorPaper, tutorInk, tutorMuted, tutorRule, tutorPanel, tutorPast, tutorAccent` (one accent only).
2. Load fonts with fontspec `Path=../fonts/` (XeLaTeX), including a font for `\tutorIPAStyle` that covers IPA.
3. Set beamer templates: `frametitle`, `footline` (and optionally `headline`), `title page`, and
   `tutor keyidea` (reads `\insertkeylabel`, `\insertkeytext`).
4. Optionally `\renewcommand` the hooks: `\tutorLabelStyle`, `\tutorLabelCase`, `\tutorNumberStyle`,
   `\tutorOriginalStyle`, `\tutorRevisedStyle`, `\tutorWhyStyle`, `\tutorWhyColumns`, `\tutorCompareSep`,
   `\tutorAsideStyle`, `\tutorCueTaskStyle`, `\tutorPromptStyle`, `\tutorTimerStyle`, `\tutorTimerBlock`,
   `\tutorKeyStyle`, `\tutorStepStyle`, `\tutorStepLabel`, `\tutorStepNote`, `\tutorObjStyle`,
   `\tutorObjNumber`, `\tutorWrapStyle`, `\tutorErrMark`, `\tutorAnswerLines`;
   lengths `\tutorLabelWidth` (0 = labels above content), `\tutorGutter`, `\tutorTimerWidth`,
   `\tutorStepLabelWidth`, `\tutorObjIndent`, `\tutorItemSep`, `\tutorFlowGap`, `\tutorStepSep`;
   TikZ styles `tutor flow key|name|text|rule|arrow|return|return label`; tcolorbox style `tutor card`.
5. Read `\insertstage`, `\ifstage{yes}{no}`, `\insertexamtag`, `\insertlessonlabel`, `\insertduration`,
   `\inserttarget`, `\insertlearner` in its templates.

## 6. Build

```bash
cd <style folder>         # a-swiss | b-book | c-focus | d-sheet
latexmk deck.tex          # latexmkrc: $pdf_mode = 5 (xelatex), TEXINPUTS += ../common
# or, from the prototypes/beamer folder:
bash build.sh a-swiss b-book c-focus d-sheet     # build + png/ at 60 dpi
python tools/sheet.py sheet a-swiss              # contact sheet
python tools/sheet.py compare compare-p3-p5.png 3,5 a-swiss b-book c-focus d-sheet
```
For Tectonic: `tectonic -Z search-path=../common deck.tex`, run from the style folder so `../fonts/` resolves (not tested here; Tectonic is not installed).
