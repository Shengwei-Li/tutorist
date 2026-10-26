import { z } from 'zod';
import type { AgentEvent, AgentProvider, AgentRunSpec } from './types.js';

export type StructuredResult<T> =
  | { ok: true; value: T; sessionId: string; attempts: number; usd: number; events: AgentEvent[] }
  | { ok: false; error: string; issues?: string[]; sessionId?: string; attempts: number; usd: number; events: AgentEvent[] };

/**
 * Run a task whose answer must match a Zod schema. The schema is sent as JSON Schema (native
 * `--json-schema` on Claude Code); the result is validated here regardless, and invalid output is
 * sent back to the same session for repair at most `maxRepairs` times (SPEC §7.2 / §7.4).
 */
export async function runStructured<S extends z.ZodType>(
  provider: AgentProvider,
  spec: Omit<AgentRunSpec, 'outputSchema'>,
  schema: S,
  opts: { maxRepairs?: number; signal?: AbortSignal; onEvent?: (e: AgentEvent) => void } = {},
): Promise<StructuredResult<z.infer<S>>> {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  const events: AgentEvent[] = [];
  let usd = 0;
  let prompt = spec.prompt;
  let resume = spec.resumeSessionId;
  const maxAttempts = (opts.maxRepairs ?? 2) + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let done: Extract<AgentEvent, { type: 'done' }> | undefined;
    let error: Extract<AgentEvent, { type: 'error' }> | undefined;
    for await (const ev of provider.run({ ...spec, prompt, resumeSessionId: resume, outputSchema: jsonSchema }, opts.signal)) {
      events.push(ev);
      opts.onEvent?.(ev);
      if (ev.type === 'usage') usd += ev.usd ?? 0;
      if (ev.type === 'done') done = ev;
      if (ev.type === 'error') error = ev;
    }
    if (error || !done) {
      return { ok: false, error: error?.message ?? 'No result', sessionId: error?.sessionId, attempts: attempt, usd, events };
    }
    const parsed = schema.safeParse(done.structured);
    if (parsed.success) return { ok: true, value: parsed.data, sessionId: done.sessionId, attempts: attempt, usd, events };

    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    if (attempt === maxAttempts) {
      return { ok: false, error: 'Output did not match the schema', issues, sessionId: done.sessionId, attempts: attempt, usd, events };
    }
    resume = done.sessionId;
    prompt = `Your previous answer did not match the required JSON schema. Problems:\n- ${issues.join('\n- ')}\nReturn the corrected JSON only.`;
  }
  return { ok: false, error: 'unreachable', attempts: maxAttempts, usd, events };
}
