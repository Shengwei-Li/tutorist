#!/usr/bin/env bash
# Build every sample in every mode, copy PDFs next to the sources and
# render 70 dpi PNGs into png/.   Usage:  ./build.sh [--cold]
set -u
cd "$(dirname "$0")"
[ "${1:-}" = "--cold" ] && rm -rf build
mkdir -p build png

build () { # source  mode
  local src=$1 mode=$2 job="${1%.tex}-$2"
  local t0=$(date +%s%N)
  latexmk -interaction=nonstopmode -halt-on-error -file-line-error \
    -usepretex="\\def\\TDmode{$mode}" -jobname="$job" "$src" > "build/$job.latexmk.txt" 2>&1
  local rc=$?
  local t1=$(date +%s%N)
  printf '%-28s rc=%d  %6d ms\n' "$job" $rc $(( (t1 - t0) / 1000000 ))
  if [ $rc -eq 0 ]; then
    cp "build/$job.pdf" .
    rm -f png/"$job"-*.png
    pdftoppm -png -r 70 "$job.pdf" "png/$job"
  else
    grep -E '\.(tex|sty|cls):[0-9]+:' "build/$job.log" | head -5
  fi
}

build handout-peel.tex     student
build handout-peel.tex     teacher
build worksheet-mixed.tex  student
build worksheet-mixed.tex  teacher
build worksheet-mixed.tex  key
build lesson-script.tex    teacher
