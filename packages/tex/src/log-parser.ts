import type { CompileJob, TexError } from './types.js';

/**
 * Parse a TeX log produced with -file-line-error. Errors come as `./file.tex:12: message`,
 * fatal ones as `! message` followed by `l.12 context`. Bad boxes and LaTeX warnings are kept
 * as lower-severity entries so the UI can flag "this page is too full" (appendix D.5).
 */
export function parseTexLog(log: string, lineMap: CompileJob['lineMap'] = []): TexError[] {
  const lines = log.split(/\r?\n/);
  const out: TexError[] = [];
  const seen = new Set<string>();
  const push = (e: TexError) => {
    const key = `${e.severity}|${e.file ?? ''}|${e.line ?? ''}|${e.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (e.line !== undefined && e.file && /main\.tex$|^\.\/[^/]+\.tex$/.test(e.file)) {
      e.nodeId = lineMap.find((m) => e.line! >= m.fromLine && e.line! <= m.toLine)?.nodeId;
    }
    out.push(e);
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const fle = /^(\.?\.?[/\\]?[^:\s][^:]*\.(?:tex|sty|cls)):(\d+): (.*)$/.exec(l);
    if (fle) {
      const ctx = lines.slice(i + 1, i + 4).find((x) => /^l\.\d+/.test(x));
      push({ severity: 'error', file: fle[1]!.replace(/\\/g, '/'), line: Number(fle[2]), message: fle[3]!.trim(), context: ctx?.replace(/^l\.\d+\s*/, '') });
      continue;
    }
    if (l.startsWith('! ')) {
      const lnum = lines.slice(i + 1, i + 12).find((x) => /^l\.\d+/.test(x));
      const m = lnum ? /^l\.(\d+)\s*(.*)$/.exec(lnum) : null;
      push({ severity: 'error', message: l.slice(2).trim(), line: m ? Number(m[1]) : undefined, file: m ? 'main.tex' : undefined, context: m?.[2] });
      continue;
    }
    // XeTeX prints a box (tofu) on the page for these; treat them as errors so they never reach a student.
    const missing = /^Missing character: There is no (\S+) \((U\+[0-9A-F]+)\) in font \[?([^\]/]*?(?:\/[^\]/]*)*)\]?/.exec(l);
    if (missing) {
      push({ severity: 'error', message: `The font cannot show "${missing[1]}" (${missing[2]}); it would print as an empty box.`, context: missing[3] });
      continue;
    }
    const box = /^(Overfull|Underfull) \\[hv]box \((.+?)\).*?(?:at lines? (\d+)(?:--(\d+))?)?$/.exec(l);
    if (box) {
      if (box[1] === 'Overfull') push({ severity: 'badbox', message: `${box[1]} box (${box[2]})`, line: box[3] ? Number(box[3]) : undefined, file: box[3] ? 'main.tex' : undefined });
      continue;
    }
    const warn = /^(?:LaTeX|Package \S+) Warning: (.*)$/.exec(l);
    if (warn) {
      let msg = warn[1]!;
      for (let j = i + 1; j < lines.length && /^\(\S+\)\s+/.test(lines[j]!); j++) msg += ` ${lines[j]!.replace(/^\(\S+\)\s+/, '')}`;
      const at = /on input line (\d+)/.exec(msg);
      push({ severity: 'warning', message: msg.trim(), line: at ? Number(at[1]) : undefined });
    }
  }
  return out;
}
