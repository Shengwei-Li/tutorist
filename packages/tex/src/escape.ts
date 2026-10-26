const MAP: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
};

/**
 * Escape plain text for LaTeX in a single pass, so replacements are never re-escaped
 * (appendix D.2). AI-written text always goes through this before reaching a template.
 */
export function escapeLatex(text: string): string {
  return text.replace(/[\\&%$#_{}~^<>]/g, (c) => MAP[c]!);
}
