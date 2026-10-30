// A scripted stand-in for `codex app-server` (argv "codex"), an ACP agent (argv "acp") or `opencode models`.
// It speaks just enough protocol to exercise the adapters; FAKE_LOG receives every message it reads.
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';

const flavour = process.argv[2];
const acp = flavour === 'acp';
let nextId = 1000;
const waiting = new Map();
let hang = null;

function send(msg) {
  process.stdout.write(`${JSON.stringify(acp ? { jsonrpc: '2.0', ...msg } : msg)}\n`);
}
function notify(method, params) {
  send({ method, params });
}
function ask(method, params) {
  const id = nextId++;
  send({ id, method, params });
  return new Promise((resolve) => waiting.set(id, resolve));
}

async function codex(msg) {
  const p = msg.params ?? {};
  switch (msg.method) {
    case 'initialize':
      return {};
    case 'thread/start':
    case 'thread/resume':
      if (p.threadId === 'thr-gone') throw new Error('no rollout found for thread id thr-gone');
      return { thread: { id: p.threadId ?? 'thr-1' }, model: 'gpt-fake' };
    case 'turn/start': {
      const text = p.input[0].text;
      const turn = { id: 'turn-1', status: 'inProgress', error: null };
      setTimeout(async () => {
        if (text.includes('hang')) {
          await new Promise((r) => (hang = r));
          notify('turn/completed', { threadId: p.threadId, turn: { ...turn, status: 'interrupted' } });
          return;
        }
        if (text.includes('crash')) process.exit(3);
        if (text.startsWith('patch ')) {
          const file = text.slice('patch '.length);
          notify('item/started', { item: { type: 'fileChange', id: 'f1', changes: [{ path: file, kind: { type: 'update' } }], status: 'inProgress' } });
          const r = await ask('item/fileChange/requestApproval', { threadId: p.threadId, turnId: 'turn-1', itemId: 'f1', reason: null });
          notify('item/agentMessage/delta', { threadId: p.threadId, turnId: 'turn-1', itemId: 'm1', delta: `decision=${r.decision}` });
          notify('turn/completed', { threadId: p.threadId, turn: { ...turn, status: 'completed' } });
          return;
        }
        if (text.includes('approve')) {
          const r = await ask('item/commandExecution/requestApproval', { threadId: p.threadId, turnId: 'turn-1', itemId: 'c1', command: 'del notes.md' });
          notify('item/agentMessage/delta', { threadId: p.threadId, turnId: 'turn-1', itemId: 'm1', delta: `decision=${r.decision}` });
        } else {
          notify('item/started', { item: { type: 'mcpToolCall', id: 'x1', server: 'tutordesk', tool: 'get_student_context', status: 'inProgress', arguments: { studentId: 'mina' } } });
          notify('item/completed', { item: { type: 'mcpToolCall', id: 'x1', server: 'tutordesk', tool: 'get_student_context', status: 'completed', arguments: {}, result: { content: [{ type: 'text', text: 'Mina Park, IELTS' }] } } });
          notify('item/agentMessage/delta', { threadId: p.threadId, turnId: 'turn-1', itemId: 'm1', delta: 'Hello ' });
          notify('item/agentMessage/delta', { threadId: p.threadId, turnId: 'turn-1', itemId: 'm1', delta: 'tutor' });
          notify('item/completed', { item: { type: 'agentMessage', id: 'm1', text: 'Hello tutor' } });
          notify('item/agentMessage/delta', { threadId: p.threadId, turnId: 'turn-1', itemId: 'm2', delta: 'Done.' });
          notify('thread/tokenUsage/updated', { threadId: p.threadId, turnId: 'turn-1', tokenUsage: { last: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 50 } } });
        }
        notify('turn/completed', { threadId: p.threadId, turn: { ...turn, status: 'completed' } });
      }, 10);
      return { turn };
    }
    case 'turn/interrupt':
      hang?.();
      return {};
    case 'model/list': {
      const model = (id, extra = {}) => ({ id, model: id, displayName: id.toUpperCase(), description: `${id} model`, hidden: false, isDefault: false, ...extra });
      return p.cursor
        ? { data: [model('gpt-old', { hidden: true })], nextCursor: null }
        : { data: [model('gpt-fast', { isDefault: true }), model('gpt-deep')], nextCursor: 'page-2' };
    }
    default:
      throw new Error(`unexpected ${msg.method}`);
  }
}

async function agent(msg) {
  const p = msg.params ?? {};
  switch (msg.method) {
    case 'initialize':
      return { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: false } } };
    case 'session/new':
      return { sessionId: 'ses-1', configOptions: [{ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'zen/small', options: [{ value: 'zen/small', name: 'Small' }, { value: 'zen/big', name: 'Big' }] }] };
    case 'session/set_config_option':
      return { configOptions: [] };
    case 'session/load':
      notify('session/update', { sessionId: p.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old history' } } });
      return null;
    case 'session/prompt': {
      const sessionId = p.sessionId;
      const text = p.prompt.map((b) => b.text ?? '').join('');
      const update = (u) => notify('session/update', { sessionId, update: u });
      if (text.includes('hang')) {
        await new Promise((r) => (hang = r));
        return { stopReason: 'cancelled' };
      }
      if (text.includes('approve')) {
        const r = await ask('session/request_permission', {
          sessionId,
          toolCall: { toolCallId: 't2', title: 'Edit notes.md', kind: 'edit' },
          options: [
            { optionId: 'a1', name: 'Allow', kind: 'allow_once' },
            { optionId: 'r1', name: 'Reject', kind: 'reject_once' },
          ],
        });
        update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `picked=${r.outcome.optionId ?? r.outcome.outcome}` } });
        // "wait-approve": the tutor cancels instead of answering; the agent then reports the cancel.
        return { stopReason: text.includes('wait-approve') ? 'cancelled' : 'end_turn' };
      }
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } });
      update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'tutordesk_save_plan', kind: 'other', status: 'pending', rawInput: { studentId: 'mina' } });
      update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'Saved plan card' } }] });
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `echo:${text.slice(-12)}` } });
      return { stopReason: 'end_turn' };
    }
    case 'session/cancel':
      hang?.();
      return undefined;
    default:
      throw new Error(`unexpected ${msg.method}`);
  }
}

// `opencode models`
if (flavour === 'opencode' && process.argv[3] === 'models') {
  process.stdout.write('zen/small\nzen/big\n\nsome banner line\n');
  process.exit(0);
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const msg = JSON.parse(line);
  if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `${line}\n`);
  if (msg.id !== undefined && !msg.method) {
    waiting.get(msg.id)?.(msg.result);
    waiting.delete(msg.id);
    return;
  }
  try {
    const result = await (acp ? agent(msg) : codex(msg));
    if (msg.id !== undefined) send({ id: msg.id, result: result ?? null });
  } catch (e) {
    if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: e.message } });
  }
});
