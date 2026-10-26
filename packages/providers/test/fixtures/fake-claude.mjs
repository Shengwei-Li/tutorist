// Stand-in for `claude -p --output-format stream-json`: replays canned events chosen by FAKE_SCENARIO.
// Records its argv and stdin to FAKE_RECORD (if set) so tests can assert on how it was invoked.
import { appendFileSync } from 'node:fs';

const scenario = process.env.FAKE_SCENARIO ?? 'success';
const args = process.argv.slice(2);

if (args[0] === '--version') {
  process.stdout.write('2.1.278 (Claude Code)\n');
  process.exit(0);
}
if (args[0] === 'auth') {
  process.stdout.write(JSON.stringify({ loggedIn: scenario !== 'logged-out', authMethod: 'claude.ai' }) + '\n');
  process.exit(0);
}
const sid = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : 'sess-1';

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  if (process.env.FAKE_RECORD) appendFileSync(process.env.FAKE_RECORD, JSON.stringify({ args, stdin }) + '\n');
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const init = { type: 'system', subtype: 'init', session_id: sid, model: 'claude-test' };
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 };

  if (scenario === 'success') {
    out(init);
    out({ type: 'stream_event', session_id: sid, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Plan' } } });
    out({ type: 'stream_event', session_id: sid, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ning…' } } });
    out({ type: 'assistant', session_id: sid, message: { content: [
      { type: 'text', text: 'Planning…' },
      { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'lessons/2026-10-26-L04/plan.json', content: '{}' } },
      { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'profile.json' } },
    ] } });
    out({ type: 'user', session_id: sid, message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
    out({ type: 'assistant', session_id: sid, parent_tool_use_id: 'sub', message: { content: [{ type: 'text', text: 'subagent noise' }] } });
    out({ type: 'result', subtype: 'success', is_error: false, result: '{"label":"Band 6.5"}', session_id: sid, total_cost_usd: 0.0123, num_turns: 2, usage, structured_output: { label: 'Band 6.5', confidence: 0.8 } });
  } else if (scenario === 'auth-fail') {
    // Captured from Claude Code 2.1.278: subtype says success, is_error/terminal_reason say otherwise.
    out(init);
    out({ type: 'assistant', session_id: sid, message: { model: '<synthetic>', content: [{ type: 'text', text: 'Failed to authenticate: OAuth session expired and could not be refreshed' }] } });
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed', terminal_reason: 'api_error', session_id: sid, total_cost_usd: 0, num_turns: 1, usage: {} });
  } else if (scenario === 'repair') {
    // First call returns schema-violating output; the resumed call fixes it.
    out(init);
    const fixed = args.includes('--resume');
    out({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: sid, total_cost_usd: 0.01, num_turns: 1, usage,
      structured_output: fixed ? { label: 'Band 6', confidence: 0.6 } : { label: 'Band 6', confidence: 7 } });
  } else if (scenario === 'text-json') {
    out(init);
    out({ type: 'result', subtype: 'success', is_error: false, result: '```json\n{"label":"Band 7","confidence":0.5}\n```', session_id: sid, num_turns: 1, usage });
  } else if (scenario === 'crash') {
    out(init);
    process.stderr.write('fatal: something broke\n');
    process.exit(3);
  } else if (scenario === 'hang') {
    out(init);
    setInterval(() => {}, 1000);
    return;
  }
});
