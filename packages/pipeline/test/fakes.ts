import type { LessonPlan, RubricReview, WritingReview } from '@tutordesk/core/artifacts';
import type { AgentEvent, AgentProvider, AgentRunSpec } from '@tutordesk/providers';

export const plan90: LessonPlan = {
  summary: 'Mina’s essays hide their position (E1) and add new ideas in the conclusion (E5), so this lesson builds a clear Task 2 position.',
  objectives: [
    { id: 'o1', text: 'Write a four-part outline for a new question in 5 minutes', criterion: 'all four parts present', checkedBy: 'st5' },
    { id: 'o2', text: 'Rewrite an opening so it states a position in two sentences', criterion: '2 of 3 rewrites state a position', checkedBy: 'st5' },
  ],
  focusErrors: [
    { code: 'W-TR-POS', evidence: '"Nowadays, with the development of society, more and more people think crime is a big problem." (submissions/2026-10-19-task2)' },
    { code: 'W-CC-CONC', evidence: 'Conclusion introduces "education is most important"' },
  ],
  stages: [
    { id: 'st1', minutes: 5, title: 'Retrieval: last essay', phase: 'retrieval', activity: 'Mina recalls the skeleton of last week’s essay.', aim: 'Notice the missing position', materials: ['deck'] },
    { id: 'st2', minutes: 15, title: 'Model: position first', phase: 'input', activity: 'Compare two openings.', aim: 'Name the difference', materials: ['handout', 'deck'] },
    { id: 'st3', minutes: 25, title: 'Guided rewrite', phase: 'guided', activity: 'Rewrite E1 and E5.', aim: 'Produce a position sentence', materials: ['handout'] },
    { id: 'st4', minutes: 5, title: 'Break', phase: 'break', activity: 'Stand up.', aim: 'Rest', materials: [] },
    { id: 'st5', minutes: 30, title: 'Independent outline + check', phase: 'check', activity: 'Outline a new question; exit check.', aim: 'Meet objectives', materials: ['worksheet', 'deck'] },
    { id: 'st6', minutes: 10, title: 'Feedback + homework', phase: 'feedback', activity: 'Review and set homework.', aim: 'Plan practice', materials: ['script'] },
  ],
  homework: ['Two outlines', 'One body paragraph'],
  outputs: ['script', 'handout', 'worksheet', 'deck'],
};

export function review(score: number, fix = 'Use Mina’s own sentence E1 in the compare block.'): RubricReview {
  return {
    scores: ['A1', 'A2', 'A3'].map((c, i) => ({ criterion: c, score: i === 1 ? score : 5, hardGate: false, evidence: 'quote', fix: i === 1 && score < 5 ? fix : '' })),
    overall: score >= 4 ? 'Ready to use.' : 'Needs personalisation.',
  };
}

export const essay = `Nowadays, with the development of society, more and more people think crime is a big problem. Some people think that the best way is longer prison sentences.

Although longer prison sentences can scare criminals, but it also has some problems. Many people which are poor will steal things. This is very important for society and very important for people.

In a word, longer sentences have advantages and disadvantages, but education is most important.`;

export const writingReview: WritingReview = {
  task: 'task2',
  criteria: [
    { id: 'TR', low: 5, high: 5.5, descriptorKeywords: ['position unclear'], evidence: ['more and more people think crime is a big problem'] },
    { id: 'CC', low: 5, high: 5.5, descriptorKeywords: ['mechanical'], evidence: ['In a word'] },
    { id: 'LR', low: 5.5, high: 6, descriptorKeywords: ['repetition'], evidence: ['very important for society and very important for people'] },
    { id: 'GRA', low: 5, high: 5.5, descriptorKeywords: ['frequent errors'], evidence: ['Many people which are poor'] },
  ],
  annotations: [
    { quote: 'Although longer prison sentences can scare criminals, but', kind: 'grammar', code: 'W-GRA-CONJ', explanation: 'although and but together', suggestion: 'Drop "but".' },
    { quote: 'Many people which are poor', kind: 'grammar', code: 'W-GRA-REL', explanation: 'which for people', suggestion: 'Many people who are poor' },
    { quote: 'very important for society and very important for people', kind: 'lexis', code: 'W-LR-REP', explanation: 'repetition', suggestion: 'vital for society as a whole' },
    { quote: 'education  is most important', kind: 'task', code: 'W-CC-CONC', explanation: 'new idea in conclusion', suggestion: 'Develop it in a body paragraph.' },
  ],
  topIssues: [
    { title: 'No clear position', why: 'Limits TR to 5', action: 'State agree/disagree in sentence two.' },
    { title: 'Conclusion adds a new idea', why: 'CC and TR', action: 'Only restate.' },
  ],
  rewrite: { original: 'Although longer prison sentences can scare criminals, but it also has some problems.', improved: 'Although longer sentences may deter some offenders, they do little to address the causes of crime.', note: 'One connector, clear subject.' },
  nextTask: 'Write only the introduction and conclusion for two new questions.',
};

/**
 * Answers by recognising the prompt, like a well-behaved model would. `script` lets a test override
 * any response by matching a substring of the prompt; calls are recorded for assertions.
 */
export class FakeProvider implements AgentProvider {
  readonly id = 'api' as const;
  calls: AgentRunSpec[] = [];
  constructor(private readonly respond: (spec: AgentRunSpec, n: number) => unknown) {}

  async capabilities() {
    return { structuredOutput: true, subagents: false, skills: false, resume: true, authModes: ['apiKey' as const] };
  }
  async healthCheck() {
    return { ok: true, installed: true, authed: true };
  }
  async *run(spec: AgentRunSpec): AsyncIterable<AgentEvent> {
    this.calls.push(spec);
    const value = this.respond(spec, this.calls.length);
    yield { type: 'init', sessionId: `s${this.calls.length}` };
    yield { type: 'usage', inputTokens: 1000, outputTokens: 200, cacheRead: 0, usd: 0.01 };
    yield { type: 'done', sessionId: `s${this.calls.length}`, finalText: '', structured: value };
  }
}

export function promptKind(p: string): 'plan' | 'revise' | 'review' | 'handout' | 'worksheet' | 'script' | 'deck' | 'transcribe' | 'essay' | 'unknown' {
  if (p.includes('Transcribe the handwritten')) return 'transcribe';
  if (p.includes('## Essay to review')) return 'essay';
  if (p.includes('## Rubric')) return 'review';
  if (p.startsWith('Revise this') || p.includes('\nRevise this')) return 'revise';
  if (p.includes('Plan this lesson as a plan card')) return 'plan';
  const m = /Write the (handout|worksheet|script|deck) for this lesson/.exec(p);
  return m ? (m[1] as 'handout') : 'unknown';
}
