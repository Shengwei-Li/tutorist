import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiProvider, portableSchema, runStructured, type AgentEvent, type AgentRunSpec, type ApiConfig } from '../src/index.js';

type GenResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;

const usage = { inputTokens: { total: 120, noCache: 100, cacheRead: 20, cacheWrite: 0 }, outputTokens: { total: 30, text: 30, reasoning: 0 } };
const text = (t: string): GenResult => ({ content: [{ type: 'text', text: t }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }) as unknown as GenResult;
const toolCall = (name: string, input: unknown): GenResult =>
  ({ content: [{ type: 'tool-call', toolCallId: `c-${name}`, toolName: name, input: JSON.stringify(input) }], finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage, warnings: [] }) as unknown as GenResult;

const cfg: ApiConfig = { gateway: 'openrouter', apiKey: 'sk-test', models: { quality: 'm-quality', balanced: 'm-balanced', fast: 'm-fast' } };
const Band = z.object({ label: z.string(), confidence: z.number().min(0).max(1) });

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'tutordesk-api-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function spec(o: Partial<AgentRunSpec> = {}): AgentRunSpec {
  return { taskType: 'extract', workspaceRoot: tmp, prompt: 'Label band 6.5', permissions: { writableGlobs: ['lessons/L1/**'], readableGlobs: ['**'], allowShell: false, allowNetwork: false }, ...o };
}

function providerWith(responses: GenResult[] | ((call: number) => GenResult | Promise<GenResult>)) {
  const models: MockLanguageModelV4[] = [];
  let call = 0;
  const p = new ApiProvider(cfg, {
    modelFactory: (id) => {
      const m = new MockLanguageModelV4({
        modelId: id,
        doGenerate: async () => (Array.isArray(responses) ? responses[call++]! : responses(call++)),
      });
      models.push(m);
      return m;
    },
  });
  return { p, models };
}

async function collect(it: AsyncIterable<AgentEvent>) {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('ApiProvider', () => {
  it('returns schema-valid structured output with usage', async () => {
    const { p, models } = providerWith([text('{"label":"Competent user","confidence":0.8}')]);
    const r = await runStructured(p, spec({ model: 'fast' }), Band);
    expect(r).toMatchObject({ ok: true, value: { label: 'Competent user' }, attempts: 1 });
    expect(models[0]!.modelId).toBe('m-fast');
    const u = r.events.find((e) => e.type === 'usage');
    expect(u).toMatchObject({ inputTokens: 120, outputTokens: 30, cacheRead: 20 });
  });

  it('repairs invalid output within the same conversation', async () => {
    const { p, models } = providerWith([text('{"label":"x","confidence":7}'), text('{"label":"x","confidence":0.7}')]);
    const r = await runStructured(p, spec(), Band);
    expect(r).toMatchObject({ ok: true, value: { confidence: 0.7 }, attempts: 2 });
    const second = models[1]!.doGenerateCalls[0]!.prompt;
    const roles = second.map((m) => m.role);
    expect(roles.filter((x) => x === 'user')).toHaveLength(2);
    expect(roles).toContain('assistant');
    expect(JSON.stringify(second.at(-1))).toMatch(/confidence/);
  });

  it('runs a jailed tool loop: reads allowed files, refuses writes outside the writable globs', async () => {
    await writeFile(path.join(tmp, 'notes.md'), 'Likes football.');
    const { p } = providerWith([
      toolCall('read_file', { path: 'notes.md' }),
      toolCall('write_file', { path: 'profile.json', content: '{}' }),
      toolCall('write_file', { path: 'lessons/L1/plan.md', content: '# Plan' }),
      text('Done.'),
    ]);
    const events = await collect(p.run(spec({ taskType: 'generate' })));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call', name: 'read_file' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', summary: 'Likes football.' }));
    expect(events).toContainEqual({ type: 'policy_violation', path: 'profile.json', tool: 'write_file' });
    expect(events).toContainEqual({ type: 'file_changed', path: 'lessons/L1/plan.md', op: 'create' });
    expect(existsSync(path.join(tmp, 'profile.json'))).toBe(false);
    expect(existsSync(path.join(tmp, 'lessons/L1/plan.md'))).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done', finalText: 'Done.', turns: 4 });
  });

  it('refuses tool paths that escape the student folder', async () => {
    const { p } = providerWith([toolCall('read_file', { path: '../../secret.txt' }), text('ok')]);
    const events = await collect(p.run(spec({ taskType: 'diagnose' })));
    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ ok: false, summary: expect.stringMatching(/escapes workspace/) });
    expect(events.at(-1)?.type).toBe('done');
  });

  it('maps a rejected key to a non-retryable error', async () => {
    const { p } = providerWith(() => {
      throw new APICallError({ message: 'Unauthorized', url: 'x', requestBodyValues: {}, statusCode: 401, isRetryable: false });
    });
    const last = (await collect(p.run(spec()))).at(-1);
    expect(last).toMatchObject({ type: 'error', retryable: false });
    expect((last as { message: string }).message).toMatch(/rejected/);
  });

  it('sends image attachments as image parts', async () => {
    await mkdir(path.join(tmp, 'submissions'), { recursive: true });
    await writeFile(path.join(tmp, 'submissions', 'essay.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const { p, models } = providerWith([text('{"label":"x","confidence":0.5}')]);
    await runStructured(p, spec({ attachments: [{ path: 'submissions/essay.png', mediaType: 'image/png' }] }), Band);
    const user = models[0]!.doGenerateCalls[0]!.prompt.find((m) => m.role === 'user');
    expect(JSON.stringify(user)).toMatch(/image\/png/);
  });

  it('checks keys against a free endpoint', async () => {
    const ok = new ApiProvider(cfg, { fetch: async () => new Response('{}', { status: 200 }) });
    expect(await ok.healthCheck()).toMatchObject({ ok: true, authed: true, authMethod: 'openrouter' });
    const bad = new ApiProvider(cfg, { fetch: async () => new Response('', { status: 401 }) });
    expect(await bad.healthCheck()).toMatchObject({ ok: false, detail: expect.stringMatching(/rejected/) });
    expect(await new ApiProvider({ ...cfg, apiKey: '' }).healthCheck()).toMatchObject({ ok: false });
    const compat = new ApiProvider({ ...cfg, gateway: 'openai-compatible' });
    expect(await compat.healthCheck()).toMatchObject({ ok: false, detail: expect.stringMatching(/base URL/) });
  });

  it('falls back to JSON mode when a provider rejects a strict schema, and remembers it', async () => {
    const reject = () => {
      throw new APICallError({ message: 'The compiled grammar is too large', url: 'x', requestBodyValues: {}, statusCode: 400, isRetryable: false });
    };
    let n = 0;
    const models: MockLanguageModelV4[] = [];
    const p = new ApiProvider({ ...cfg, models: { ...cfg.models, quality: 'strict-limited' } }, {
      modelFactory: (id) => {
        const m = new MockLanguageModelV4({ modelId: id, doGenerate: async (opts) => (opts.responseFormat?.type === 'json' && opts.responseFormat.schema ? reject() : (n++, text('{"label":"x","confidence":0.4}'))) });
        models.push(m);
        return m;
      },
    });
    const r = await runStructured(p, spec(), Band);
    expect(r).toMatchObject({ ok: true, value: { confidence: 0.4 } });
    const fallback = models.at(-1)!.doGenerateCalls[0]!;
    expect(fallback.responseFormat).toMatchObject({ type: 'json' });
    expect(JSON.stringify(fallback.prompt)).toContain('conforms to this JSON Schema');
    expect(ApiProvider.jsonModeModels.has('strict-limited')).toBe(true);
    const before = models.length;
    await runStructured(p, spec(), Band);
    expect(models.length - before).toBe(1); // straight to JSON mode, no rejected strict attempt
    expect(n).toBe(2);
  });

  it('makes schemas portable without touching property names', () => {
    const s = z.object({ pattern: z.string().regex(/^a/), format: z.string(), list: z.array(z.string()).max(3), kind: z.literal('x'), u: z.discriminatedUnion('t', [z.object({ t: z.literal('a') }), z.object({ t: z.literal('b') })]) });
    const js = JSON.stringify(portableSchema(z.toJSONSchema(s)));
    expect(js).toContain('"pattern":{"type":"string"}');
    expect(js).toContain('"format":{"type":"string"}');
    expect(js).not.toMatch(/"maxItems"|"const"|"oneOf"|"\^a"/);
    expect(js).toContain('"enum":["x"]');
  });

  it('maps tiers and passes explicit model ids through', () => {
    const p = new ApiProvider(cfg);
    expect(p.resolveModelId('balanced')).toBe('m-balanced');
    expect(p.resolveModelId(undefined)).toBe('m-quality');
    expect(p.resolveModelId('vendor/custom-model')).toBe('vendor/custom-model');
  });
});
