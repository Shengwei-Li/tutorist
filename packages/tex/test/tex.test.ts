import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TexEngine, detectSystemTex, escapeLatex, parseTexLog } from '../src/index.js';

const TEMPLATES = fileURLToPath(new URL('../../../workspace-template/templates/tex/', import.meta.url));
const SAMPLES = path.join(TEMPLATES, 'samples');

describe('escapeLatex', () => {
  it('escapes specials in one pass', () => {
    expect(escapeLatex('50% of A&B cost $5 #1 a_b {x} ~ ^ \\')).toBe(
      '50\\% of A\\&B cost \\$5 \\#1 a\\_b \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}',
    );
    expect(escapeLatex('plain words stay')).toBe('plain words stay');
  });
});

describe('parseTexLog', () => {
  const log = [
    './main.tex:14: Undefined control sequence.',
    'l.14 \\badmacro',
    '                {x}',
    '! LaTeX Error: File `missing.sty\' not found.',
    '',
    'l.3 \\usepackage',
    'Overfull \\hbox (12.5pt too wide) in paragraph at lines 20--22',
    'Underfull \\hbox (badness 10000) in paragraph at lines 5--5',
    'LaTeX Warning: Reference `x\' on page 1 undefined on input line 30.',
  ].join('\n');

  it('extracts errors, overfull boxes and warnings, mapped to nodes', () => {
    const errs = parseTexLog(log, [{ fromLine: 10, toLine: 16, nodeId: 'q3' }, { fromLine: 18, toLine: 25, nodeId: 'p2' }]);
    expect(errs[0]).toMatchObject({ severity: 'error', file: './main.tex', line: 14, nodeId: 'q3', context: '\\badmacro' });
    expect(errs[1]).toMatchObject({ severity: 'error', line: 3, message: expect.stringContaining('missing.sty') });
    expect(errs.find((e) => e.severity === 'badbox')).toMatchObject({ line: 20, nodeId: 'p2' });
    expect(errs.filter((e) => e.message.startsWith('Underfull'))).toHaveLength(0);
    expect(errs.find((e) => e.severity === 'warning')).toMatchObject({ line: 30 });
  });
});

const tex = await detectSystemTex({ skipPackageCheck: true });

describe.skipIf(!tex)('TexEngine with local TeX', () => {
  const engine = new TexEngine({ maxConcurrent: 2 });
  let tmp: string;
  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-tex-test-'));
  });
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('detects the installation and required packages', async () => {
    const info = await detectSystemTex();
    expect(info?.version).toMatch(/TeX Live|MiKTeX/);
    expect(info?.missingFiles).toEqual([]);
  });

  it('compiles the handout sample in student and teacher modes', async () => {
    const mainTex = await readFile(path.join(SAMPLES, 'handout-peel.tex'), 'utf8');
    const student = await engine.compile({ mainTex, templateDir: TEMPLATES, buildDir: path.join(tmp, 'h-s') });
    expect(student.errors.filter((e) => e.severity === 'error'), student.log.slice(-1500)).toEqual([]);
    expect(student.ok).toBe(true);
    expect(student.pdf!.subarray(0, 5).toString()).toBe('%PDF-');

    const teacher = await engine.compile({ mainTex, templateDir: TEMPLATES, buildDir: path.join(tmp, 'h-t'), pretex: '\\def\\TDmode{teacher}' });
    expect(teacher.ok).toBe(true);
    expect(teacher.pdf!.length).toBeGreaterThan(student.pdf!.length);
  }, 120_000);

  it('compiles the Beamer deck with the default tutorswiss theme', async () => {
    const r = await engine.compile({
      mainTex: await readFile(path.join(SAMPLES, 'deck.tex'), 'utf8'),
      files: { 'lesson-peel.tex': await readFile(path.join(SAMPLES, 'lesson-peel.tex'), 'utf8') },
      templateDir: TEMPLATES,
    });
    expect(r.errors.filter((e) => e.severity === 'error'), r.log.slice(-1500)).toEqual([]);
    expect(r.ok).toBe(true);
  }, 120_000);

  it('reports errors with line and node id', async () => {
    const mainTex = ['\\documentclass{article}', '\\begin{document}', 'Fine line.', '\\notamacro{x}', '\\end{document}'].join('\n');
    const r = await engine.compile({ mainTex, templateDir: TEMPLATES, lineMap: [{ fromLine: 3, toLine: 4, nodeId: 'para-1' }] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ severity: 'error', line: 4, nodeId: 'para-1' });
  }, 60_000);

  it('blocks shell escape', async () => {
    const marker = path.join(tmp, 'pwned.txt');
    const mainTex = `\\documentclass{article}\\begin{document}\\immediate\\write18{echo x > "${marker.replace(/\\/g, '/')}"}ok\\end{document}`;
    await engine.compile({ mainTex, templateDir: TEMPLATES });
    expect(existsSync(marker)).toBe(false);
  }, 60_000);

  it('kills runaway compiles at the timeout', async () => {
    const mainTex = '\\documentclass{article}\\begin{document}\\def\\loop{x\\loop}\\loop\\end{document}';
    const r = await engine.compile({ mainTex, templateDir: TEMPLATES, timeoutMs: 4000 });
    expect(r.ok).toBe(false);
    expect(r.timedOut || r.errors.some((e) => /capacity|timed out/i.test(e.message))).toBe(true);
  }, 60_000);

  it('cancels superseded compiles of the same document', async () => {
    const slow = '\\documentclass{article}\\begin{document}\\def\\loop{x\\loop}\\loop\\end{document}';
    const fast = '\\documentclass{article}\\begin{document}hello\\end{document}';
    const first = engine.compileLatest('doc', { mainTex: slow, templateDir: TEMPLATES, timeoutMs: 30_000 });
    await new Promise((r) => setTimeout(r, 300));
    const second = engine.compileLatest('doc', { mainTex: fast, templateDir: TEMPLATES });
    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(true);
  }, 60_000);
});
