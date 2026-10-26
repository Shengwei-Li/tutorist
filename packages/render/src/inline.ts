import { escapeLatex } from '@tutordesk/tex';

export interface InlineOptions {
  /** Allow [[gap:answer]] (worksheet gap-fill only). */
  gaps?: boolean;
  /** Allow [[err:]], [[fix:]] and [[sample:]] (deck only). */
  deck?: boolean;
  /** Turn `||` into a \beat pause mark (lesson script talk). */
  beats?: boolean;
}

const TOKEN = /\[\[(gap|blank|ipa|err|fix|sample):([^\]]*?)\]\]|\{\{([^|}]+)\|([^}]+)\}\}|\*([^*\n]+)\*|(\|\|)/g;

/**
 * Convert the restricted inline markup the model may use into LaTeX (appendix D.2).
 * Everything outside markup is escaped; unknown or disallowed markup is printed as plain text.
 */
export function renderInline(text: string, opts: InlineOptions = {}): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out += escapeLatex(text.slice(last, m.index));
    last = m.index + m[0].length;
    const [whole, tag, body, glossWord, glossText, emph, beat] = m;
    if (tag) {
      const b = escapeLatex(body ?? '');
      if (tag === 'ipa') out += `\\ipa{${b}}`;
      else if ((tag === 'gap' || tag === 'blank') && opts.gaps) out += `\\${tag}{${b}}`;
      else if ((tag === 'err' || tag === 'fix' || tag === 'sample') && opts.deck) out += `\\${tag}{${b}}`;
      else if (tag === 'sample') out += `\\enquote{${b}}`;
      else out += b;
    } else if (glossWord) {
      out += `\\gloss{${escapeLatex(glossWord.trim())}}{${escapeLatex(glossText!.trim())}}`;
    } else if (emph) {
      out += `\\emph{${renderInline(emph, { ...opts })}}`;
    } else if (beat) {
      out += opts.beats ? '\\beat{}' : escapeLatex(whole);
    }
  }
  out += escapeLatex(text.slice(last));
  return out;
}

/** True when the text needs CJK fonts (Chinese glosses). */
export function hasCjk(text: string): boolean {
  return /[㐀-鿿豈-﫿　-〿＀-￯]/.test(text);
}

/** Collapse markup to plain text (for length budgets and checks). */
export function plainText(text: string): string {
  return text
    .replace(/\[\[(?:gap|blank|ipa|err|fix|sample):([^\]]*?)\]\]/g, '$1')
    .replace(/\{\{([^|}]+)\|[^}]+\}\}/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\|\|/g, '');
}
