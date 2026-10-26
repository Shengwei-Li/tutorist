import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';

export type Parsed<T> = { ok: true; value: T } | { ok: false; file: string; issues: string[] };

/** Write via temp file + rename so a crash never leaves a half-written file. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function formatIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

/** Read and validate JSON. Hand-edited files that break the schema return issues instead of throwing. */
export async function readJson<S extends z.ZodType>(file: string, schema: S): Promise<Parsed<z.infer<S>>> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    return { ok: false, file, issues: [`cannot read: ${(e as Error).message}`] };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, file, issues: [`invalid JSON: ${(e as Error).message}`] };
  }
  const r = schema.safeParse(data);
  return r.success ? { ok: true, value: r.data } : { ok: false, file, issues: formatIssues(r.error) };
}

export async function appendJsonl(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(value)}\n`, 'utf8');
}

export async function readJsonl<S extends z.ZodType>(
  file: string,
  schema: S,
): Promise<{ items: z.infer<S>[]; bad: { line: number; issues: string[] }[] }> {
  let raw = '';
  try {
    raw = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], bad: [] };
    throw e;
  }
  const items: z.infer<S>[] = [];
  const bad: { line: number; issues: string[] }[] = [];
  raw.split(/\r?\n/).forEach((line, idx) => {
    if (!line.trim()) return;
    try {
      const r = schema.safeParse(JSON.parse(line));
      if (r.success) items.push(r.data);
      else bad.push({ line: idx + 1, issues: formatIssues(r.error) });
    } catch (e) {
      bad.push({ line: idx + 1, issues: [`invalid JSON: ${(e as Error).message}`] });
    }
  });
  return { items, bad };
}
