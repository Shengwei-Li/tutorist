This is the README for the atkinson package, version
2026-01-16.

This package provides LaTeX, pdfLaTeX, XeLaTeX and LuaLaTeX
support for the Atkinson Hyperlegible family of fonts,
named after Braille Institute founder, J. Robert Atkinson.
What makes it different from traditional typography design
is that it focuses on letterform distinction to increase
character recognition, ultimately improving readability.

To install this package on a TDS-compliant
TeX system download the file
"tex-archive"/install/fonts/atkinson.tds.zip, where the
preferred URL for "tex-archive" is http://mirror.ctan.org.
Unzip the archive at the root of an appropriate texmf tree,
likely a personal or local tree. If necessary, update the
file-name database (e.g., texhash). Update the font-map
files by enabling the Map file atkinson.map.

To use, add

\usepackage{atkinson}

to the preamble of your document. This makes Atkinson
Hyperlegible Next the default sans family and makes Atkinson
Hyperlegible Mono the default monospaced font. To also set
Atkinson Hyperlegible Next as the main text font, use

\usepackage[sfdefault]{atkinson}

To suppress the Mono variant, use the nomono option.

LuaLaTeX and xeLaTeX users who might prefer type1 fonts or
who wish to avoid fontspec may use the type1 option.

Options scaled=<number> or scale=<number> may be used to
adjust the sans fontsizes to match a serifed font.

The default weights are Regular and Bold but the following
options may be used to obtain other weights:

  medium
  light
  extralight
  
  semibold
  extrabold

The default figure style for the sans fonts is
proportional-lining but the following option may be used to
get tabular figures:

  tabular (or t)

The following allow for localized use of non-default figure
styles:

\atkinsonlf{...}   (proportional lining)
\atkinsontlf{...}  (tabular lining)

Font encodings supported are OT1, T1, TS1, and LY1.

The original opentype fonts are available at
https://brailleinstitute.org/freefont and are licensed under
the Atkinson Hyperlegible Font License; the text may be
found in the doc directory. The type1 versions were created
using cfftot1 and named in accordance with the Reserved
Typeface Name condition. The support files were created
using autoinst and are licensed under the terms of the LaTeX
Project Public License. The maintainer of this package is
Bob Tennent (rdt at cs.queensu.ca)
