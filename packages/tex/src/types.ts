import type { ResolvedCommand } from '@tutordesk/core';

/** Where the TeX binaries come from (appendix D.3). M0 implements the system kinds; Tectonic comes in M4. */
export type EngineKind = 'system-texlive' | 'system-miktex' | 'tectonic';

export interface EngineInfo {
  kind: EngineKind;
  binDir: string;
  /** e.g. "TeX Live 2026" or "MiKTeX 24.1". */
  version: string;
  xelatex: ResolvedCommand;
  latexmk?: ResolvedCommand;
  kpsewhich?: ResolvedCommand;
  /** Required .sty/.cls files that kpsewhich could not find. */
  missingFiles: string[];
}

export interface CompileJob {
  /** Main .tex source. */
  mainTex: string;
  /** Extra files written next to main.tex (inputs, images). Keys are relative paths. */
  files?: Record<string, string | Buffer>;
  /** Folder with .cls/.sty templates and a fonts/ subfolder (workspace templates/tex). */
  templateDir: string;
  /** Persistent build directory; a temp directory is used and removed when omitted. */
  buildDir?: string;
  /** Pre-TeX code, e.g. `\def\TDmode{teacher}` for teacher editions. */
  pretex?: string;
  jobname?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Maps generated .tex line ranges back to artifact nodes (appendix D.2). */
  lineMap?: Array<{ fromLine: number; toLine: number; nodeId: string }>;
}

export interface TexError {
  severity: 'error' | 'warning' | 'badbox';
  message: string;
  file?: string;
  line?: number;
  nodeId?: string;
  context?: string;
}

export interface CompileResult {
  ok: boolean;
  pdf?: Buffer;
  pdfPath?: string;
  log: string;
  errors: TexError[];
  durationMs: number;
  engine: Pick<EngineInfo, 'kind' | 'version'>;
  timedOut?: boolean;
}

/** Files every template needs (from the packages the templates load). */
export const REQUIRED_TEX_FILES = [
  'fontspec.sty',
  'xcolor.sty',
  'geometry.sty',
  'fancyhdr.sty',
  'lastpage.sty',
  'microtype.sty',
  'multicol.sty',
  'needspace.sty',
  'tabularx.sty',
  'booktabs.sty',
  'enumitem.sty',
  'graphicx.sty',
  'tcolorbox.sty',
  'tikz.sty',
  'ulem.sty',
  'iftex.sty',
  'hyperref.sty',
  'beamer.cls',
  'xeCJK.sty',
] as const;
