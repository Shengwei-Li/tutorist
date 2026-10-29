% =====================================================================
%  tutordesk.cls  --  TutorDesk teaching materials (IELTS / PTE)
%  Engine: XeLaTeX only (Tectonic-compatible).   Paper: A4.
%  Fonts are loaded by file from \TDfontpath (default: fonts/), never by
%  system name. Override with \def\TDfontpath{../fonts/} before the class.
%
%  Modes (one switch):  student (default) | teacher | key
%    - class option:  \documentclass[teacher]{tutordesk}
%    - or from the command line, before the class is read:
%        latexmk -xelatex -jobname=foo-teacher -usepretex="\def\TDmode{teacher}" foo.tex
%  Other options: chinese (xeCJK + Fandol), inlineanswers (teacher mode:
%  also typeset every solution in place).
%
%  Design rules: one accent colour (ink blue #24508F); every distinction
%  carried by colour is also carried by weight, shape, rule style or a
%  label, so the page survives black-and-white printing.
% =====================================================================
\NeedsTeXFormat{LaTeX2e}[2023/11/01]
\ProvidesClass{tutordesk}[2026/10/26 v0.3 TutorDesk teaching materials]

\newif\ifTD@teacher
\newif\ifTD@key
\newif\ifTD@chinese
\newif\ifTD@inlineanswers
\newif\ifTD@discard
\def\TD@mode{student}
\DeclareOption{student}{\def\TD@mode{student}}
\DeclareOption{teacher}{\def\TD@mode{teacher}}
\DeclareOption{key}{\def\TD@mode{key}}
\DeclareOption{chinese}{\TD@chinesetrue}
\DeclareOption{inlineanswers}{\TD@inlineanswerstrue}
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{article}}
\ProcessOptions\relax
\ifdefined\TDmode \edef\TD@mode{\TDmode}\fi
\def\TD@tmp{teacher}\ifx\TD@mode\TD@tmp \TD@teachertrue \fi
\def\TD@tmp{key}\ifx\TD@mode\TD@tmp \TD@teachertrue\TD@keytrue \fi

\LoadClass[a4paper,11pt]{article}

% ---------------------------------------------------------------------
%  Packages (kept deliberately small)
% ---------------------------------------------------------------------
\RequirePackage{iftex}
\RequireXeTeX
\RequirePackage{fontspec}
\RequirePackage[a4paper,top=29mm,bottom=24mm,left=23mm,right=23mm,
  headheight=11mm,headsep=7mm,footskip=11mm]{geometry}
\RequirePackage{xcolor}
\RequirePackage{graphicx}
\RequirePackage{fancyhdr}
\RequirePackage{lastpage}
\RequirePackage{microtype}
\RequirePackage{enumitem}
\RequirePackage{multicol}
\RequirePackage{needspace}
\RequirePackage{array}
\RequirePackage{tabularx}
\RequirePackage{booktabs}

% ---------------------------------------------------------------------
%  Colour: one accent, greys for structure only
% ---------------------------------------------------------------------
\definecolor{tdaccent}{HTML}{24508F}
\colorlet{tdmeta}{black!62}
\colorlet{tdrule}{black!45}
\colorlet{tdhair}{black!22}

% ---------------------------------------------------------------------
%  Fonts: Source Serif 4 (text), Source Sans 3 (structure),
%  Charis SIL (IPA). All ship with TeX Live.
% ---------------------------------------------------------------------
\providecommand\TDfontpath{fonts/}
\setmainfont{SourceSerif4}[Path=\TDfontpath,Extension=.otf,
  UprightFont=*-Regular,ItalicFont=*-RegularIt,
  BoldFont=*-Semibold,BoldItalicFont=*-SemiboldIt,Numbers=Lining]
\setsansfont{SourceSans3}[Path=\TDfontpath,Extension=.otf,
  UprightFont=*-Regular,ItalicFont=*-RegularIt,
  BoldFont=*-Semibold,BoldItalicFont=*-SemiboldIt,Numbers=Lining]
\newfontfamily\TD@numfamily{SourceSans3}[Path=\TDfontpath,Extension=.otf,
  UprightFont=*-Semibold,BoldFont=*-Bold,ItalicFont=*-SemiboldIt,
  Numbers={Lining,Monospaced}]
\newfontfamily\TD@labelfamily{SourceSans3}[Path=\TDfontpath,Extension=.otf,
  UprightFont=*-Semibold,BoldFont=*-Bold,Numbers={Lining,Monospaced},
  LetterSpace=7]
\newfontfamily\TD@ipafamily{CharisSIL}[Path=\TDfontpath,Extension=.ttf,
  UprightFont=*-Regular,ItalicFont=*-Italic,
  BoldFont=*-Bold,BoldItalicFont=*-BoldItalic,Scale=MatchLowercase]
% symbols (check, cross, arrow) come from Source Sans 3
\newcommand\TD@check{{\sffamily\char"2713}}
\newcommand\TD@cross{{\sffamily\char"2717}}
\newcommand\TD@arrow{{\sffamily\char"2192}}

\ifTD@chinese
  \RequirePackage{xeCJK}
  \setCJKmainfont{FandolSong}[Path=\TDfontpath,Extension=.otf,
    UprightFont=*-Regular,BoldFont=*-Bold]
  \setCJKsansfont{FandolHei}[Path=\TDfontpath,Extension=.otf,
    UprightFont=*-Regular,BoldFont=*-Regular,FakeBold=2]
  \xeCJKsetup{CJKspace=true}
  % keep Western punctuation in the Latin fonts: by default xeCJK treats
  % curly quotes, the middle dot, dashes and the ellipsis as CJK characters
  \xeCJKDeclareCharClass{Default}{"2018,"2019,"201C,"201D,"00B7,"2013,"2014,"2026}
\fi

% Type scale: 10.5 / 14.5 body; everything else a step on this grid.
\renewcommand\normalsize{%
  \@setfontsize\normalsize{10.5}{14.5}%
  \abovedisplayskip 8pt plus 2pt minus 4pt
  \belowdisplayskip \abovedisplayskip
  \abovedisplayshortskip 0pt plus 3pt
  \belowdisplayshortskip 5pt plus 2pt
  \let\@listi\@listI}
\renewcommand\small{\@setfontsize\small{9.5}{13}}
\renewcommand\footnotesize{\@setfontsize\footnotesize{8.5}{11.5}}
\renewcommand\scriptsize{\@setfontsize\scriptsize{7.5}{9.5}}
\renewcommand\large{\@setfontsize\large{12.5}{16}}
\renewcommand\Large{\@setfontsize\Large{15}{19}}
\renewcommand\LARGE{\@setfontsize\LARGE{21}{25}}
\normalsize

\setlength\parindent{0pt}
\setlength\parskip{5pt plus 1.5pt}
\raggedbottom
\frenchspacing
\widowpenalty=10000 \clubpenalty=10000
\emergencystretch=1.5em

% Semantic small type helpers (also used by the other .sty files)
\newcommand\TD@kicker[1]{\leavevmode{\TD@labelfamily\footnotesize\color{tdaccent}\MakeUppercase{#1}}}
\newcommand\TD@label[2][]{\leavevmode{\TD@labelfamily\scriptsize\if\relax\detokenize{#1}\relax\else\color{#1}\fi\MakeUppercase{#2}}}
\newcommand\TD@qnum[1]{{\TD@numfamily #1}}
\newcommand\headlabel[1]{\TD@label[tdmeta]{#1}}% public: table column heads
\providecommand\enquote[1]{\char"201C\relax#1\char"201D\relax}% curly quotes without csquotes
\newcommand\ipa[1]{{\TD@ipafamily #1}}

% ---------------------------------------------------------------------
%  Metadata
% ---------------------------------------------------------------------
\def\TD@studio{Studio name}
\def\TD@initials{TD}
\def\TD@logo{}
\def\TD@student{Student}
\def\TD@lesson{1}
\def\TD@date{\today}
\def\TD@exam{}
\def\TD@doctype{Handout}
\def\TD@subtitle{}
\def\TD@level{}
\def\TD@timing{}
\def\TD@focus{}
\newcommand\studio[2][]{\def\TD@studio{#2}\if\relax\detokenize{#1}\relax\else\def\TD@initials{#1}\fi}
\newcommand\logo[1]{\def\TD@logo{#1}}
\newcommand\student[1]{\def\TD@student{#1}}
\newcommand\lesson[1]{\def\TD@lesson{#1}}
\newcommand\lessondate[1]{\def\TD@date{#1}}
\newcommand\exam[1]{\def\TD@exam{#1}}
\newcommand\doctype[1]{\def\TD@doctype{#1}}
\newcommand\subtitle[1]{\def\TD@subtitle{#1}}
\newcommand\level[1]{\def\TD@level{#1}}
\newcommand\timing[1]{\def\TD@timing{#1}}
\newcommand\focus[1]{\def\TD@focus{#1}}

% ---------------------------------------------------------------------
%  Running head / foot
% ---------------------------------------------------------------------
\newcommand\TD@logobox{%
  \ifx\TD@logo\@empty
    {\setlength\fboxsep{0pt}\setlength\fboxrule{0.6pt}%
     \fbox{\parbox[b][7mm][c]{7mm}{\centering
       \TD@numfamily\footnotesize\color{tdaccent}\TD@initials}}}%
  \else
    \includegraphics[height=7.6mm]{\TD@logo}%
  \fi}
\newcommand\TD@edition{%
  \ifTD@key Answer key\else\ifTD@teacher Teacher's edition\fi\fi}

\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\TD@logobox\hspace{2.5mm}%
  {\sffamily\bfseries\small\TD@studio}}
\fancyhead[R]{{\sffamily\small\color{tdmeta}%
  \TD@student\enspace\textperiodcentered\enspace
  Lesson~\TD@lesson\enspace\textperiodcentered\enspace\TD@date}}
\fancyfoot[L]{{\sffamily\footnotesize\color{tdmeta}%
  \TD@doctype\ifx\TD@exam\@empty\else\enspace\textperiodcentered\enspace\TD@exam\fi
  \ifTD@teacher\enspace\textperiodcentered\enspace
    {\color{black}\rule[0.1ex]{0.8ex}{0.8ex}\,\TD@edition}\fi}}
\fancyfoot[R]{{\TD@numfamily\footnotesize\thepage\,\textcolor{tdmeta}{/\,\pageref{LastPage}}}}
\renewcommand\headrulewidth{0.4pt}
\renewcommand\headrule{{\color{tdrule}\hrule\@height\headrulewidth\@width\headwidth}\vskip-\headrulewidth}
\renewcommand\footrulewidth{0pt}
\fancypagestyle{plain}{}

% ---------------------------------------------------------------------
%  Title block
% ---------------------------------------------------------------------
\newcommand\TD@metaitem[2]{% #2 is a macro holding the value
  \ifx#2\@empty\else
    {\TD@label[tdmeta]{#1}}\hspace{1.6mm}{\sffamily\small #2}\hspace{7mm}%
  \fi}
\newcommand\TD@titleblock[1]{%
  \par\noindent
  \TD@kicker{#1}%
  \ifTD@teacher\hfill{\TD@label{\rule[0.05ex]{0.85ex}{0.85ex}\hspace{1.2mm}\TD@edition}}\fi
  \par\nobreak\vspace{3pt}%
  \noindent{\sffamily\bfseries\LARGE\raggedright\@title\par}\nobreak
  \ifx\TD@subtitle\@empty\else
    \vspace{3pt}\noindent{\large\itshape\color{tdmeta}\TD@subtitle\par}\nobreak
  \fi
  \vspace{9pt}%
  \noindent\TD@metaitem{Level}{\TD@level}\TD@metaitem{Time}{\TD@timing}%
  \TD@metaitem{Focus}{\TD@focus}\par\nobreak
  \vspace{4pt}{\hrule height 0.8pt}\vspace{12pt}}
% answer pages: full title block when the key is a document of its own,
% a compact one when it closes the teacher's edition
\newcommand\TD@answershead[1]{%
  \ifTD@key\TD@titleblock{#1}\else
    \par\noindent\TD@kicker{#1}\par\nobreak\vspace{2pt}%
    \noindent{\sffamily\bfseries\Large\raggedright\@title\par}\nobreak
    \vspace{6pt}{\hrule height 0.8pt}\vspace{8pt}%
  \fi}
\renewcommand\maketitle{%
  \TD@titleblock{\ifx\TD@exam\@empty\TD@doctype\else\TD@exam\fi}}

% ---------------------------------------------------------------------
%  Headings
% ---------------------------------------------------------------------
\setcounter{secnumdepth}{0}
\renewcommand\section{\@startsection{section}{1}{\z@}%
  {-17pt plus -4pt minus -2pt}{5pt}{\sffamily\bfseries\large\color{tdaccent}\raggedright}}
\renewcommand\subsection{\@startsection{subsection}{2}{\z@}%
  {-12pt plus -3pt minus -2pt}{3pt}{\sffamily\bfseries\normalsize\raggedright}}
\renewcommand\subsubsection{\@startsection{subsubsection}{3}{\z@}%
  {-9pt plus -2pt}{-0.6em}{\sffamily\bfseries\normalsize}}

% Lists
\setlist{itemsep=2pt,parsep=0pt,topsep=3pt,partopsep=0pt}
\setlist[itemize]{label=\textendash,leftmargin=1.3em}
\setlist[enumerate]{label={\TD@numfamily\arabic*},leftmargin=1.6em}

% ---------------------------------------------------------------------
%  Answer collection (shared by every exercise type)
% ---------------------------------------------------------------------
\ExplSyntaxOn
% The bundled Tectonic ships an older kernel (2022) without these e-type variants; newer ones
% already have them, and generating a variant that exists does nothing.
\cs_generate_variant:Nn \tl_set:Nn { Ne }
\cs_generate_variant:Nn \tl_gset:Nn { Ne }
\cs_generate_variant:Nn \tl_put_right:Nn { Ne }
\cs_generate_variant:Nn \tl_gput_right:Nn { Ne }
\cs_generate_variant:Nn \prop_gput:Nnn { Nne }
\tl_new:N \g_td_answers_tl
\tl_new:N \g__td_pending_head_tl
\bool_new:N \g__td_keyopen_bool

% register the heading for the current exercise (printed lazily)
\cs_new_protected:Npn \td_answer_section:nn #1#2
  {
    \tl_gset:Ne \g__td_pending_head_tl
      { \exp_not:N \__td_key_head:nn { #1 } { \exp_not:n {#2} } }
  }
\cs_new_protected:Npn \td_add_answer:nn #1#2
  {
    \tl_if_empty:NF \g__td_pending_head_tl
      {
        \tl_gput_right:No \g_td_answers_tl \g__td_pending_head_tl
        \tl_gclear:N \g__td_pending_head_tl
      }
    \tl_gput_right:Ne \g_td_answers_tl
      { \exp_not:N \__td_key_item:nn { #1 } { \exp_not:n {#2} } }
  }
\cs_generate_variant:Nn \td_add_answer:nn { en, ee }
\cs_new_protected:Npn \td_add_why:n #1
  { \tl_gput_right:Nn \g_td_answers_tl { \__td_key_why:n {#1} } }

\cs_new_protected:Npn \__td_key_open:
  {
    \bool_if:NF \g__td_keyopen_bool
      {
        \begin{list}{}{
          \setlength\labelwidth{7mm}\setlength\labelsep{1mm}
          \setlength\leftmargin{8mm}\setlength\itemsep{2.5pt}
          \setlength\parsep{0pt}\setlength\topsep{2pt}
          \cs_set:Npn \makelabel ##1 { \TD@numfamily\small ##1 \hfil } }
        \raggedright
        \bool_gset_true:N \g__td_keyopen_bool
      }
  }
\cs_new_protected:Npn \__td_key_close:
  {
    \bool_if:NT \g__td_keyopen_bool
      { \end{list} \bool_gset_false:N \g__td_keyopen_bool }
  }
\cs_new_protected:Npn \__td_key_head:nn #1#2
  {
    \__td_key_close:
    \par\addvspace{10pt}
    \noindent
    \makebox[8mm][l]{ \TD@numfamily\color{tdaccent} #1 }
    { \sffamily\bfseries #2 }
    \cs_if_exist:cT { TD@range@#1 }
      { \nobreak\hfill\penalty 100 \hspace{2mm}\null\nobreak\hfill
        { \sffamily\footnotesize\color{tdmeta}\use:c{TD@range@#1} } }
    \par\nobreak
    \vspace{1pt}
    \__td_key_open:
  }
\cs_new_protected:Npn \__td_key_item:nn #1#2
  { \__td_key_open: \item[#1] #2 }
\cs_new_protected:Npn \__td_key_why:n #1
  { \par {\small\itshape\color{tdmeta} #1 \par} }

% ---- solution: collected for the key; inline only with `inlineanswers`
\tl_new:N \l__td_sol_label_tl
\NewDocumentEnvironment{solution}{ o +b }
  {
    \IfValueTF {#1}
      { \tl_set:Nn \l__td_sol_label_tl {#1} }
      { \legacy_if:nTF { TD@inq } { \tl_set:Ne \l__td_sol_label_tl { \thetdq } }
                                  { \tl_clear:N \l__td_sol_label_tl } }
    \td_add_answer:Vn \l__td_sol_label_tl {#2}
    \legacy_if:nT { TD@teacher } { \legacy_if:nT { TD@inlineanswers }
      {
        \par\addvspace{3pt}
        \noindent \TD@label{Answer} \hspace{2mm} { \small #2 } \par
      } }
  }
  { }
\cs_generate_variant:Nn \td_add_answer:nn { Vn }

\NewDocumentCommand \why { m } { \td_add_why:n {#1} }

% ---- \printanswers: new page in teacher mode; whole output in key mode
\NewDocumentCommand \printanswers { O{Answer~key} }
  {
    \legacy_if:nT { TD@teacher }
      {
        \clearpage
        \legacy_if:nT { TD@key }
          { \global\TD@discardfalse \setcounter{page}{1} }
        \TD@answershead{#1}
        \begin{multicols}{2}
          \raggedcolumns
          \bool_gset_false:N \g__td_keyopen_bool
          \g_td_answers_tl
          \__td_key_close:
        \end{multicols}
      }
  }
\ExplSyntaxOff

% key mode: typeset everything (numbering stays identical) but ship only
% the answer pages.
\AddToHook{shipout/before}{\ifTD@discard\DiscardShipoutBox\fi}
\AtBeginDocument{\ifTD@key\global\TD@discardtrue\fi}

% ---------------------------------------------------------------------
%  teachernote: teacher / key mode only
% ---------------------------------------------------------------------
\NewDocumentEnvironment{teachernote}{O{Teacher note} +b}{%
  \ifTD@teacher
    \par\addvspace{7pt}%
    \begingroup\sffamily\small\setlength\parskip{3pt}%
    \noindent{\rule[0.1ex]{0.85ex}{0.85ex}}\hspace{1.4mm}%
    \TD@label{#1}\hspace{2.2mm}\ignorespaces#2\par
    \endgroup\addvspace{7pt}%
  \fi}{}

% ---------------------------------------------------------------------
%  Handout environments
% ---------------------------------------------------------------------
\newlength\TD@qindent \setlength\TD@qindent{7mm}

% objectives -----------------------------------------------------------
\NewDocumentEnvironment{objectives}{O{By the end of this lesson, you will be able to:}}{%
  \par\addvspace{2pt}\noindent\TD@kicker{Objectives}\par\nobreak\vspace{1pt}%
  \noindent{\itshape #1}\par\nobreak
  \begin{enumerate}[label={\TD@numfamily\color{tdaccent}\arabic*},
    leftmargin=\TD@qindent,labelsep=0pt,labelwidth=\TD@qindent,align=left,
    itemsep=1pt,topsep=2pt]}%
  {\end{enumerate}\par\addvspace{6pt}}

% keypoint: accent rule above, hairline below, run-in label -----------
\NewDocumentEnvironment{keypoint}{o}{%
  \par\addvspace{10pt}\needspace{4\baselineskip}%
  {\color{tdaccent}\hrule height 0.9pt}\nobreak\vspace{5pt}%
  \noindent\TD@kicker{Key point}%
  \IfValueT{#1}{\hspace{2.5mm}{\sffamily\bfseries #1}}\par\nobreak\vspace{1pt}}%
  {\par\vspace{5pt}{\color{tdrule}\hrule height 0.4pt}\addvspace{10pt}}

% example / nonexample / compare ----------------------------------------
\newif\ifTD@incompare
\newif\ifTD@firstcompare
\newcommand\TD@dashrule[1]{\hbox to #1{\leaders\hbox to 4.2pt{\vrule height 0.9pt width 2.6pt\hss}\hfill}}
\newcommand\TD@exhead[3]{% mark, label, solid?
  \ifnum#3=1 \hrule height 0.9pt\else\TD@dashrule{\linewidth}\fi
  \nointerlineskip\vspace{4pt}%
  \noindent{\normalsize #1}\hspace{1.6mm}{\sffamily\bfseries\small #2}\par\nobreak\vspace{1pt}}
\newcommand\TD@exopen[3]{%
  \ifTD@incompare
    \ifTD@firstcompare\global\TD@firstcomparefalse\else\hfill\fi
    \begin{minipage}[t]{\dimexpr(\linewidth-7mm)/2\relax}%
    \setlength\parskip{4pt}\small\raggedright\TD@exhead{#1}{#2}{#3}%
  \else
    \par\addvspace{8pt}\needspace{3\baselineskip}\TD@exhead{#1}{#2}{#3}%
  \fi}
\newcommand\TD@exclose{%
  \ifTD@incompare\par\end{minipage}\else\par\addvspace{8pt}\fi}
\NewDocumentEnvironment{example}{O{Effective}}
  {\TD@exopen{\TD@check}{#1}{1}}{\TD@exclose\ignorespacesafterend}
\NewDocumentEnvironment{nonexample}{O{Less effective}}
  {\TD@exopen{\TD@cross}{#1}{0}}{\TD@exclose\ignorespacesafterend}
\newenvironment{compare}
  {\par\addvspace{8pt}\noindent\TD@incomparetrue\global\TD@firstcomparetrue\ignorespaces}
  {\par\addvspace{8pt}}

% \seg{P}: framed functional label inside a model text
\newcommand\seg[1]{{\setlength\fboxsep{0.9pt}\setlength\fboxrule{0.45pt}%
  \fbox{\TD@numfamily\scriptsize\makebox[1.15em]{#1}}}\hspace{0.3em}\ignorespaces}

% \gloss{word}{note}: interlinear gloss set directly under the word, so the
% explanation stays next to the text it explains (never a footnote).
% Chinese notes need the `chinese' class option.
\newcommand\gloss[2]{\leavevmode\begingroup\setbox0\hbox{#1}%
  \setbox2\hbox{{\sffamily\scriptsize\color{tdmeta}#2}}%
  \vtop{\hbox to\wd0{\unhcopy0}\kern1.4pt
    \hbox to\wd0{\hss\box2\hss}}\endgroup}
% \sidegloss{note}: a short note set flush right on the same line
\newcommand\sidegloss[1]{\unskip\nobreak\hfill\penalty50\hskip1em\null\nobreak
  \hfill{\sffamily\footnotesize\color{tdmeta}#1}\par}

% vocab / \chunk[ipa]{phrase}{pattern or gloss}{example} ----------------
\NewDocumentEnvironment{vocab}{O{Chunk} O{Pattern and example}}{%
  \par\addvspace{6pt}%
  \noindent\parbox[t]{0.31\linewidth}{\TD@label[tdmeta]{#1}}\hfill
  \parbox[t]{0.66\linewidth}{\TD@label[tdmeta]{#2}}\par\nobreak
  \vspace{2pt}\hrule height 0.6pt\nobreak\vspace{1pt}}
  {\par\addvspace{8pt}}
\NewDocumentCommand\chunk{o m m m}{%
  \par\vspace{3pt}%
  \noindent\parbox[t]{0.31\linewidth}{\raggedright\sffamily\bfseries #2%
    \IfValueT{#1}{\\[-1pt]{\mdseries\normalsize\ipa{#1}}}}\hfill
  \parbox[t]{0.66\linewidth}{\raggedright\leavevmode{\sffamily\small\color{tdmeta}#3}\\[0pt]%
    {\itshape #4}}\par
  \vspace{3pt}{\color{tdhair}\hrule height 0.4pt}}

% selfcheck: empty square boxes -----------------------------------------
\newcommand\TD@checkbox{{\setlength\fboxsep{0pt}\setlength\fboxrule{0.55pt}%
  \raisebox{-0.2ex}{\framebox[2.7mm]{\rule{0pt}{2.7mm}}}}}
\NewDocumentEnvironment{selfcheck}{O{Self-check}}{%
  \par\addvspace{8pt}\needspace{3\baselineskip}%
  \noindent\TD@kicker{#1}\par\nobreak
  \begin{itemize}[label=\TD@checkbox,leftmargin=\TD@qindent,labelsep=0pt,
    labelwidth=\TD@qindent,align=left,itemsep=3pt,topsep=3pt]}
  {\end{itemize}\par\addvspace{6pt}}

\RequirePackage{td-exercises}
\endinput
