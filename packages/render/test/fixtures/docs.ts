import type { DeckDoc, HandoutDoc, ScriptDoc, WorksheetDoc } from '@tutordesk/core/artifacts';

/** Realistic artifacts for the golden student (appendix A.1), written the way the model is asked to. */

export const handout: HandoutDoc = {
  kind: 'handout',
  meta: { title: 'Taking a position in Task 2', subtitle: 'An introduction that tells the examiner where you stand', level: 'Band 5.5 to 6.5', timing: '90 min', focus: 'Task Response · Coherence and Cohesion' },
  blocks: [
    { type: 'objectives', id: 'obj', lead: null, items: ['write a four-part outline for a new question in 5 minutes;', 'rewrite an opening so it states a clear position in two sentences;', 'spot a paragraph with *more than one* main idea.'] },
    { type: 'section', id: 's1', title: 'Your opening, and a better one' },
    {
      type: 'compare',
      id: 'cmp1',
      good: { label: 'Effective · states a position', segments: [{ tag: 'P', text: 'Some people argue that longer prison sentences are the best way to reduce crime.' }, { tag: 'Ex', text: 'Although harsher punishment may deter some offenders, I disagree, since tackling poverty would prevent more crimes.' }] },
      weak: { label: 'Your diagnostic opening', text: 'Nowadays, with the development of society, more and more people think crime is a big problem.' },
      question: 'Which sentence tells the examiner your answer to the question?',
    },
    { type: 'keypoint', id: 'kp1', title: 'Position first, background second', text: 'Background does not earn marks for Task Response. A clear {{position|立场}} in the introduction, kept all the way to the conclusion, does.' },
    {
      type: 'vocab',
      id: 'v1',
      entries: [
        { phrase: 'I largely agree that', ipa: null, pattern: 'position + clause', example: 'I largely agree that schools should teach practical skills.' },
        { phrase: 'deter someone from', ipa: '/dɪˈtɜː/', pattern: 'verb + object + from + -ing', example: 'Fines deter drivers from speeding.' },
      ],
    },
    {
      type: 'exercise',
      id: 'ex1',
      exercise: {
        id: 'ex1',
        title: 'Find the position',
        tag: 'IELTS Writing Task 2',
        instructions: 'Choose the opening that states a clear position.',
        twoColumn: true,
        items: [
          { type: 'mcq', id: 'q1', stem: 'Question: Should university be free?', options: ['Education is important.', 'I disagree that university should be free for everyone.', 'Many people go to university.'], answer: 1, why: 'Only B answers the question.' },
          { type: 'mcq', id: 'q2', stem: 'Question: Should cities ban cars from centres?', options: ['Cars are common.', 'This essay will discuss cars.', 'I largely agree that centres should be car-free.'], answer: 2, why: null },
        ],
      },
    },
    { type: 'selfcheck', id: 'sc', title: null, items: ['My first paragraph has a position word (agree / disagree / largely agree).', 'My conclusion adds no new reason.'] },
    { type: 'teachernote', id: 'tn', title: 'Diagnosis', text: 'E1 and E5 from lesson 1 (W-TR-POS, W-CC-CONC).' },
  ],
};

export const worksheet: WorksheetDoc = {
  kind: 'worksheet',
  meta: { title: 'Mixed practice: position, dictation and gaps', subtitle: null, level: 'IELTS 6 / PTE 58', timing: '45 min', focus: 'Task Response, spelling' },
  exercises: [
    {
      id: 'e1',
      title: 'True, False or Not Given',
      tag: 'IELTS Reading',
      instructions: 'Read the passage, then decide whether statements 1–3 agree with it.',
      twoColumn: true,
      items: [
        { type: 'passage', id: 'p1', title: 'Quiet streets', note: 'Practice text written for this worksheet.', paragraphs: [{ label: 'A', text: 'When a city closes a street to cars, local shops often worry. Yet studies in several European cities found that footfall rose within a year.' }, { label: 'B', text: 'Residents reported less noise, although delivery firms complained about longer routes.' }] },
        { type: 'tfng', id: 't1', variant: 'TFNG', statements: [{ text: 'Shop owners usually welcome car-free streets at first.', answer: 'FALSE', why: 'Para A: shops often worry.' }, { text: 'Footfall increased in some cities.', answer: 'TRUE', why: null }, { text: 'Delivery costs doubled.', answer: 'NOT GIVEN', why: null }] },
      ],
    },
    {
      id: 'e2',
      title: 'Note completion',
      tag: 'IELTS Listening',
      instructions: 'Write ONE WORD AND/OR A NUMBER for each answer.',
      twoColumn: true,
      items: [{ type: 'gapfill', id: 'g1', title: 'Library induction', lines: ['Opens at [[gap:8.30]] on weekdays', 'Bring your [[gap:card]] to borrow books', 'Quiet zone on the [[gap:second]] floor', 'Late fee: 20p per [[gap:day]]'] }],
    },
    {
      id: 'e3',
      title: 'Fill in the blanks',
      tag: 'PTE Reading',
      instructions: 'Choose the word that best completes each sentence.',
      twoColumn: true,
      items: [
        { type: 'mcq', id: 'm1', stem: 'The policy had a ___ effect on traffic.', options: ['significant', 'significance', 'signify'], answer: 0, why: 'Adjective before a noun.' },
        { type: 'mcq', id: 'm2', stem: 'Results were ___ to earlier studies.', options: ['similar', 'same', 'alike'], answer: 0, why: 'similar to' },
        { type: 'short', id: 'sh1', prompt: 'Rewrite with a position: *University fees are a topic.*', model: 'I disagree that university fees should be abolished.' },
      ],
    },
    {
      id: 'e4',
      title: 'Write from dictation',
      tag: 'PTE Listening',
      instructions: 'Your teacher reads each sentence once. Write it exactly.',
      twoColumn: false,
      items: [{ type: 'dictation', id: 'd1', sentences: ['The assignment must be submitted before the end of the week.', 'Most participants preferred the second version of the survey.'] }],
    },
    {
      id: 'e5',
      title: 'Re-order paragraphs',
      tag: 'PTE Reading',
      instructions: 'Put the sentences in the correct order.',
      twoColumn: false,
      items: [{ type: 'reorder', id: 'r1', paragraphs: [{ text: 'However, the trial was later extended to every district.', position: 3 }, { text: 'The council first tested the scheme in one area.', position: 1 }, { text: 'Early results showed a sharp fall in noise complaints.', position: 2 }] }],
    },
    {
      id: 'e6',
      title: 'Outline a new question',
      tag: 'IELTS Writing Task 2',
      instructions: 'Spend five minutes. One line per move.',
      twoColumn: true,
      items: [{ type: 'writing', id: 'w1', prompt: 'Some people believe university education should be free for everyone. To what extent do you agree or disagree?', lines: 8, model: 'Position: largely disagree. Reason 1: cost shifts to taxpayers. Reason 2: targeted grants help more.' }],
    },
  ],
};

export const script: ScriptDoc = {
  kind: 'script',
  meta: { title: 'Lesson 3: taking a position', subtitle: null, level: 'Band 5.5 → 6.5', timing: '90 min', focus: 'Task Response' },
  materials: ['Handout: Taking a position', 'Worksheet: Mixed practice', 'Mina’s diagnostic essay (lesson 1)'],
  stages: [
    { id: 'st1', minutes: 5, title: 'Warm-up: your essay skeleton', aim: 'They notice the missing position.', steps: [{ type: 'say', text: 'Look only at these four lines. || Do you know whether the writer agrees?' }, { type: 'expect', items: ['Not really.'] }, { type: 'probe', items: ['Where would the examiner find your answer?'] }] },
    { id: 'st2', minutes: 15, title: 'Model: position first', aim: null, steps: [{ type: 'action', items: ['Show the handout compare box.'] }, { type: 'board', text: 'position + two reasons = thesis' }] },
    { id: 'st3', minutes: 25, title: 'Guided practice', aim: 'They rewrite E1.', steps: [{ type: 'say', text: 'Rewrite your own opening in two sentences.' }, { type: 'fallback', condition: 'If they finish early', text: 'Try a concession: Although…, I believe…' }] },
    { id: 'st4', minutes: 5, title: 'Break', aim: null, steps: [{ type: 'action', items: ['Stand up, water.'] }] },
    { id: 'st5', minutes: 30, title: 'Independent: outline + exit check', aim: null, steps: [{ type: 'action', items: ['Worksheet exercise 6, five minutes.', 'Exit check Q1–Q3.'] }] },
    { id: 'st6', minutes: 10, title: 'Feedback and homework', aim: null, steps: [{ type: 'say', text: 'Two outlines and one body paragraph for Thursday.' }] },
  ],
};

export const deck: DeckDoc = {
  kind: 'deck',
  meta: { title: 'Taking a position in Task 2', subtitle: 'Tell the examiner where you stand', examTag: 'IELTS Academic · Writing Task 2', duration: '90 min', target: 'Band 6.5' },
  frames: [
    { type: 'frame', id: 'f-goals', stage: 'Goals', title: 'Today you will state a position', blocks: [{ type: 'objectives', items: ['Outline a new question in five minutes.', 'Rewrite an opening with a clear position.'], bandFocus: 'Task Response · Coherence and Cohesion' }], aside: null },
    { type: 'frame', id: 'f-diag', stage: 'Diagnose', title: 'Your opening hides your answer', blocks: [{ type: 'compare', original: 'Nowadays, [[err:with the development of society]], more and more people think crime is [[err:a big problem]].', revised: 'Some argue longer sentences reduce crime, but I [[fix:disagree]]: [[fix:prevention works better]].', notes: ['cliché opener, no position', 'vague; name your view'] }], aside: 'Ask them to find the position before revealing.' },
    { type: 'frame', id: 'f-peel', stage: 'Structure', title: 'Each body paragraph defends one reason', blocks: [{ type: 'peel', point: 'One claim.', explain: 'Why it is true.', example: 'A specific case.', link: 'Back to the question.' }], aside: null },
    { type: 'keyframe', id: 'k1', label: 'Rule of thumb', text: 'Position first, background second.' },
    { type: 'frame', id: 'f-reveal', stage: 'Model', title: 'Build the thesis step by step', blocks: [{ type: 'reveal', steps: [{ label: 'Paraphrase', text: 'Some people argue that university should be free.', note: null }, { label: 'Position', text: 'I largely disagree.', note: 'one word decides TR' }, { label: 'Reasons', text: 'Fees fund quality, and grants can target need.', note: null }] }], aside: null },
    { type: 'frame', id: 'f-timed', stage: 'Practise', title: 'Five minutes: outline a new question', blocks: [{ type: 'timed', caption: null, time: '5:00', prompt: 'Some people believe university education should be free for everyone. To what extent do you agree or disagree?', phases: [{ time: '0--1 min', text: 'Choose a position.' }, { time: '1--5 min', text: 'Two reasons, one example each.' }] }], aside: null },
    { type: 'frame', id: 'f-card', stage: 'Speak', title: 'Say it before you write it', blocks: [{ type: 'cuecard', title: 'IELTS Speaking · Part 2', task: 'Describe a rule at your school that you disagreed with.', cues: ['what the rule was', 'who made it', 'why you disagreed'], explain: 'and explain whether the rule was changed.', timing: '1 min to prepare · 2 min to speak' }], aside: null },
    { type: 'frame', id: 'f-wrap', stage: 'Check', title: 'Exit check', blocks: [{ type: 'wrapup', summary: ['Position in sentence two.', 'One reason per paragraph.'], words: [{ word: 'deter', ipa: 'dɪˈtɜː', gloss: 'stop by making afraid' }], exit: ['Fix: [[sample:Nowadays, crime is a big problem.]]', 'Name two position words.'] }], aside: null },
  ],
};
