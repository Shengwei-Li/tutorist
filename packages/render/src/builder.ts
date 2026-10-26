/** Accumulates .tex lines and remembers which line range each artifact node produced. */
export class TexBuilder {
  private lines: string[] = [];
  readonly lineMap: { fromLine: number; toLine: number; nodeId: string }[] = [];

  line(s = ''): this {
    for (const l of s.split('\n')) this.lines.push(l);
    return this;
  }

  /** Emit a node; with `anchor` a hypertarget lets the PDF viewer find it (appendix D.5). */
  node(id: string, fn: () => void, anchor = true): this {
    const from = this.lines.length + 1;
    if (anchor) this.line(`\\hypertarget{n:${id.replace(/[^A-Za-z0-9-]/g, '-')}}{}%`);
    fn();
    this.lineMap.push({ fromLine: from, toLine: this.lines.length, nodeId: id });
    return this;
  }

  toString(): string {
    return `${this.lines.join('\n')}\n`;
  }
}
