#!/usr/bin/env bash
# Build one or more style folders: ./build.sh a-swiss b-book ...
# Compiles deck.tex with XeLaTeX via latexmk, then renders png/ at 60 dpi.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
for d in "$@"; do
  cd "$here/$d" || exit 1
  start=$(date +%s.%N)
  latexmk deck.tex > build.log 2>&1
  status=$?
  end=$(date +%s.%N)
  printf '%s: latexmk exit %s, %.1fs\n' "$d" "$status" "$(echo "$end - $start" | bc 2>/dev/null || python -c "print($end-$start)")"
  grep -n -E '^\.\./|^\./|^!|Overfull \\vbox|Missing character' deck.log | head -20
  rm -rf png && mkdir png
  pdftoppm -png -r 60 deck.pdf png/p
done
