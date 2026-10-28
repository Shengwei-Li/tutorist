/**
 * Development-only provider (TUTORDESK_FAKE_AI=1): answers with fixture documents so the whole UI flow
 * can be exercised and screenshotted without an API key. Never enabled in normal use.
 */
import type { AgentProvider } from '@tutordesk/providers';
import type { ThreadSubject } from '../shared/ipc.js';
import { deck, handout, script, worksheet } from '../../../../packages/render/test/fixtures/docs.js';
import { FakeProvider, essay, plan90, promptKind, review, writingReview } from '../../../../packages/pipeline/test/fakes.js';

export function createFakeProvider(): AgentProvider {
  const docs = { handout, worksheet, script, deck } as const;
  let lastKind: keyof typeof docs = 'handout';
  return new FakeProvider((spec) => {
    const k = promptKind(spec.prompt);
    if (k === 'plan') return plan90;
    if (k === 'review') return review(5);
    if (k === 'essay') return writingReview;
    if (k === 'transcribe') return { text: essay, unsure: [] };
    if (k === 'revise') {
      const m = /Revise this (plan card|handout|worksheet|script|deck)/.exec(spec.prompt);
      if (m?.[1] === 'plan card') return plan90;
      const kind = (m?.[1] as keyof typeof docs | undefined) ?? lastKind;
      return docs[kind];
    }
    if (k in docs) {
      lastKind = k as keyof typeof docs;
      return docs[lastKind];
    }
    throw new Error(`fake AI: unrecognised prompt (${k})`);
  });
}

/**
 * Development-only chat model for agent threads (TUTORDESK_FAKE_AI=1): calls the real TutorDesk tools
 * with fixture documents, so checks, typesetting and the whole thread UI run without an API key.
 */
export async function createFakeChatModel(subject: ThreadSubject) {
  const { MockLanguageModelV4 } = await import('ai/test');
  const { simulateReadableStream } = await import('ai');
  const usage = { inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 120, text: 120, reasoning: 0 } };
  const ids = subject.type === 'lesson' ? { studentId: subject.studentId, lessonId: subject.lessonId } : { studentId: subject.type === 'workspace' ? '' : subject.studentId, lessonId: '' };
  const day = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  type Chunk = Record<string, unknown>;
  const say = (t: string, done: 'stop' | 'tool-calls' = 'stop'): Chunk[] => [
    { type: 'text-start', id: 't' },
    ...t.split(/(?<= )/).map((w) => ({ type: 'text-delta', id: 't', delta: w })),
    { type: 'text-end', id: 't' },
    ...(done === 'stop' ? [{ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage }] : []),
  ];
  const calls = (list: [string, unknown][]): Chunk[] => [
    ...list.map(([toolName, input], i) => ({ type: 'tool-call', toolCallId: `fake-${Date.now()}-${i}`, toolName, input: JSON.stringify(input) })),
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
  ];
  const docs = { script, handout, worksheet, deck } as const;
  const respond = (prompt: { role: string; content: unknown }[]): Chunk[] => {
    const last = prompt.at(-1);
    if (last?.role === 'tool') {
      if (JSON.stringify(last.content).includes('propose_')) return say('I put it on a card below. Check it, change anything that is off, and confirm.');
      return JSON.stringify(last.content).includes('save_plan')
        ? say('The plan card is saved and its checks passed. Review it on the right and approve it when you are happy.')
        : say('Done. The documents are saved and checked; open each tab on the right to see the PDF.');
    }
    // What the tutor typed, without the note TutorDesk adds about confirmed cards.
    const text = JSON.stringify(last?.content ?? '').replace(/\[TutorDesk:[^\]]*\]/g, '').toLowerCase();
    if (subject.type === 'workspace') {
      const student = {
        name: 'Wang Yiran',
        exam: 'ielts-academic',
        targetOverall: 6.5,
        examDate: day(75),
        ageOrGrade: 'Year 11',
        delivery: { mode: 'online', sessionsPerWeek: 2, minutesPerSession: 90 },
        targetBySkill: { writing: 6.5 },
        interests: ['basketball', 'science fiction'],
        learningStyle: 'Quiet at first; needs a worked example before trying alone.',
      };
      const lessons = [{ date: day(2), topic: 'Diagnostic: Task 2 and Speaking' }, { date: day(5), topic: 'Task 2 introductions' }];
      return [...say('Turning that into a profile.', 'tool-calls'), ...calls([['propose_student', { student, lessons, note: 'Gloss language assumed Chinese; no parent contact given.' }]])];
    }
    if (subject.type === 'student') {
      if (/lesson|schedule|课/.test(text))
        return [...say('Scheduling the next lessons.', 'tool-calls'), ...calls([['propose_lessons', { studentId: ids.studentId, lessons: [{ date: day(4), topic: 'Task 2 body paragraphs' }, { date: day(7), topic: 'Speaking Part 2' }, { date: day(11) }], note: 'Twice a week, keeping her usual length.' }]])];
      return [...say('Updating the profile.', 'tool-calls'), ...calls([['propose_profile_update', { studentId: ids.studentId, changes: { goal: { targetOverall: 7, examDates: [day(60)] }, interests: ['basketball', 'films'] }, note: 'Target and exam date from what you said today.' }]])];
    }
    // The recipes arrive in the interface language.
    if (/material|write|prepare|材料|写/.test(text)) return [...say('Writing the four documents from the approved plan.', 'tool-calls'), ...calls(Object.entries(docs).map(([kind, doc]) => ['save_artifact', { ...ids, kind, doc }]))];
    if (/plan|计划|备/.test(text)) return [...say('Reading the student context, then drafting the plan card.', 'tool-calls'), ...calls([['get_student_context', ids], ['save_plan', { ...ids, plan: plan90 }]])];
    return say('I can plan this lesson, write its materials or change one of them. What would you like?');
  };
  return new MockLanguageModelV4({
    modelId: 'fake',
    doStream: async (opts) => ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...respond(opts.prompt as { role: string; content: unknown }[])], chunkDelayInMs: 15 }) }) as never,
  });
}
