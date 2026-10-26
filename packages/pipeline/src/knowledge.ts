/**
 * Ground-truth knowledge injected into prompts (SPEC §5.1, appendices A–C). The model must take exam
 * facts from here, never from memory. Descriptor summaries are our own paraphrases, not official text.
 */
import type { ExamId } from '@tutordesk/core';

export const IELTS_FACTS = `IELTS facts (use only these; do not add rules):
- Writing: Task 1 (about 20 min, at least 150 words) and Task 2 (about 40 min, at least 250 words). Task 2 counts twice as much as Task 1.
- Each task is marked on four equally weighted criteria: Task Achievement (Task 1) or Task Response (Task 2), Coherence and Cohesion, Lexical Resource, Grammatical Range and Accuracy.
- Writing under the word count is reflected in the Task Achievement/Response judgement; there is no fixed deduction per missing word.
- Academic Task 1 needs an overview of the main features; without one Task Achievement is hard to lift above 5. General Training Task 1 is a letter covering three bullet points in a suitable tone.
- Speaking: Fluency and Coherence, Lexical Resource, Grammatical Range and Accuracy, Pronunciation. Part 2: one minute to prepare, then speak for up to two minutes; the examiner stops the candidate at two minutes. A short Part 2 is not penalised by a fixed rule, but gives less evidence for Fluency and Lexical Resource.
- Overall band = mean of the four skills rounded to the nearest half band (x.25 rounds up to x.5, x.75 rounds up to the next whole band).
- Computer-delivered IELTS is the main format in most centres; candidates type their essays.

Writing descriptor summary (paraphrased; distinguishes bands 5, 6 and 7):
- TR 5: a position is present but may be unclear or inconsistent; ideas limited or not developed; may be repetitive. TR 6: a relevant position, though conclusions may be unclear or repetitive; main ideas relevant but some under-developed. TR 7: a clear position throughout; main ideas extended and supported, though some may over-generalise.
- CC 5: some organisation but no clear progression; cohesive devices inadequate, inaccurate or overused. CC 6: coherent arrangement with overall progression; cohesive devices used but sometimes faulty or mechanical; paragraphing not always logical. CC 7: logically organised with clear progression; a range of cohesive devices, some under- or over-use; each paragraph has a clear central topic.
- LR 5: limited range, minimally adequate; noticeable errors in spelling or word formation that may strain the reader. LR 6: adequate range; attempts less common words with some inaccuracy; errors do not impede communication. LR 7: enough range for flexibility and precision; less common items used with awareness of style and collocation; occasional errors.
- GRA 5: limited range; complex sentences attempted but less accurate than simple ones; frequent errors. GRA 6: a mix of simple and complex forms; some errors that rarely reduce communication. GRA 7: a variety of complex structures; frequent error-free sentences; good control with a few errors.`;

export const PTE_FACTS = `PTE Academic facts (use only these; some 2025 details are unverified, so do not state exact weightings):
- About two hours, computer-based, scored automatically. Overall and the four communicative skills (Listening, Reading, Speaking, Writing) are reported on 10–90.
- Many task types contribute to more than one skill (e.g. Read Aloud → Speaking and Reading; Repeat Sentence → Speaking and Listening; Write From Dictation → Listening and Writing; Reading & Writing Fill in the Blanks → Reading and Writing).
- Form rules can zero an answer: Summarize Written Text is one sentence of 5–75 words in 10 minutes; Write Essay is 200–300 words in 20 minutes; Summarize Spoken Text is 50–70 words in 10 minutes.
- Multiple-choice multiple-answer and Highlight Incorrect Words use negative marking: wrong selections cost points.
- Speaking is scored for content, oral fluency and pronunciation; long hesitations, repetitions and self-corrections hurt fluency.
- Goals are usually per-skill visa or university thresholds (e.g. 65 or 79 in every skill), so the weakest skill decides the plan.
- Templates help structure Describe Image and Re-tell Lecture, but the 2025 updates strengthened detection of memorised responses: content must stay specific to the item.`;

export const TAXONOMY = `Error codes (use these exact codes):
Writing: W-TR-POS position unclear or inconsistent; W-TR-DEV ideas not developed; W-TR-PART part of the question not answered; W-TR-OFF off-topic or memorised; W-CC-PARA more than one main idea in a paragraph; W-CC-MECH mechanical linking words; W-CC-REF unclear reference; W-CC-CONC new idea in the conclusion; W-LR-REP repetition; W-LR-COLL wrong collocation; W-LR-FORM word form or spelling; W-LR-MIS misused "advanced" word; W-GRA-SVA subject–verb agreement; W-GRA-REL relative clause; W-GRA-CONJ doubled conjunction (although…but); W-GRA-TENSE tense; W-GRA-ART articles; W-GRA-PUNC punctuation.
Speaking: S-FC-PAUSE unnatural pauses; S-FC-LEN answers too short; S-FC-FILL too many fillers; S-GRA-TENSE tense consistency; S-P-PHON individual sounds; S-P-STRESS stress or intonation.
Reading/Listening: L1–L4 locating; P1–P3 paraphrase not recognised; V1–V4 vocabulary/spelling/word form; G1–G3 sentence understanding; R1–R4 reasoning (TFNG confusion, over-inference, attitude, main idea); D1–D3 distractors; T1–T4 time and strategy; S1–S2 answer rules (word limit, format).
PTE: PTE-FORM-SWT, PTE-FORM-WC, PTE-WFD-MISS, PTE-WFD-SPELL, PTE-RS-MISS, PTE-FLU-HES, PTE-FLU-REP, PTE-DI-STRUCT, PTE-MC-NEG, PTE-FIB-COLL, PTE-FIB-GRAM, PTE-TIME.`;

export const ERROR_CODE_RE = /^(W-(TR-(POS|DEV|PART|OFF)|CC-(PARA|MECH|REF|CONC)|LR-(REP|COLL|FORM|MIS)|GRA-(SVA|REL|CONJ|TENSE|ART|PUNC))|S-(FC-(PAUSE|LEN|FILL)|GRA-TENSE|P-(PHON|STRESS))|[LPVGRDTS][1-4]|PTE-(FORM-(SWT|WC)|WFD-(MISS|SPELL)|RS-MISS|FLU-(HES|REP)|DI-STRUCT|MC-NEG|FIB-(COLL|GRAM)|TIME))$/;

export const TEACHING_RULES = `Teaching design rules (evidence-based; follow them):
1. Open with retrieval: the student recalls or corrects last lesson's material from memory (5–8 min), not a re-explanation.
2. New skills: full worked example → partially completed example → independent attempt. Fade examples faster for stronger students.
3. Put an effective and a less effective version side by side and mark only the one difference; ask the student to name it.
4. Guided practice should run at about 80% success; if it is far lower, return to modelling.
5. Block a new task type first; interleave it with similar older types only once the student can tell them apart.
6. Recycle the student's earlier errors at spaced intervals; change the surface form each time.
7. One emphasis style per page and at most three emphasised items; never ask the student to highlight.
8. Slides never carry the tutor's script; the script holds the talk. Slide titles state the point as a sentence.
9. Glosses sit right next to the word they explain.
10. Student produces first, then compares with a model and finds the gap, then the tutor adds.
11. Focused correction: one or two error types per piece of work. Weaker students get the correct form; stronger students get a code and correct it themselves.
12. Organise tasks as pre-task → task → language focus; the student speaks or writes for at least half the lesson; the tutor never lectures for more than five minutes at a stretch.
13. Short items (MCQ, gaps, TFNG, dictation, vocabulary) may go in two columns; reading passages and essay or summary answer lines stay full width.`;

export const QUALITY_BAR = `Quality bar (a reviewer will check every point):
- Objectives are observable and measurable, each with a pass criterion and a stage that checks it.
- Everything is personalised: cite at least two of the student's own errors or sentences and use them in practice.
- Difficulty: models and texts one half to one band above the student's current level (i+1), never band 9 showpieces.
- No exam-rule claims beyond the facts given. No promises of score gains.
- One-to-one wording: never "class", "everyone", "students, …" or group work.
- Original practice texts only; never reproduce published exam material.
- Refer to the student by name or with they/them.
- Every model, "good" or revised sentence must itself meet the lesson objective (in a lesson on stating a position, every improved opening states a position). Check each one before answering.`;

export function examFacts(exam: ExamId): string {
  return exam.startsWith('pte') ? PTE_FACTS : IELTS_FACTS;
}

export function examLabel(exam: ExamId): string {
  return { 'ielts-academic': 'IELTS Academic', 'ielts-general': 'IELTS General Training', 'pte-academic': 'PTE Academic', 'pte-core': 'PTE Core' }[exam];
}

/** Authoring rules per artifact, mirroring the LaTeX macro budgets (appendix D, MACROS.md). */
export const ARTIFACT_RULES = {
  handout: `Handout rules:
- 1–2 A4 pages. One topic per page. Start with an objectives block (2–3 items).
- Structure: objectives → worked example and a compare block (good vs weak, weak taken from the student's own writing where possible) → keypoint (one rule) → vocab (3–6 chunks with pattern and example) → a short practice exercise the student completes on the page → selfcheck.
- In a compare block, split the good model into segments tagged with its moves (e.g. P, Ex, Eg, L).
- Glosses: use {{word|gloss}} only for words the student is unlikely to know, in the student's gloss language; none for strong students.
- Emphasis: at most three *emphasised* words per block.
- teachernote blocks hold notes for the tutor only (hidden from the student copy).`,
  worksheet: `Worksheet rules:
- Order: warm-up recycling 1–2 earlier errors → the lesson's new task type (blocked) → an interleaved older task type → a timed exam-style task.
- Every auto-gradable item carries its answer in the data (answer, statements[].answer, [[gap:answer]], positions). Never print answers in prompt text.
- TFNG uses TRUE/FALSE/NOT GIVEN; YNNG uses YES/NO/NOT GIVEN; TF uses TRUE/FALSE only.
- Listening note gaps: ONE WORD AND/OR A NUMBER unless stated otherwise; keep gap answers short.
- Passages are original, 150–350 words, written for this worksheet; add the note "Practice text written for this worksheet."
- Set twoColumn true only when an exercise is mostly short items.
- Include a "why" explanation for most objective items (locating clue or rule).
- Re-order items: link the sentences with pronouns, connectors and given-new information so that exactly one order works; check this before answering.
- Instructions say exactly what to write, the word limit and the time.`,
  script: `Lesson script rules:
- Stages must add up exactly to the lesson length. First stage is retrieval; include a check stage near the end and a short homework stage.
- Each stage: verbatim tutor talk in "say" steps (natural spoken English, short sentences, use || for a pause), "expect" for likely answers, "probe" for diagnostic follow-up questions (never "Do you understand?"), "action" for directions, "board" for what to write up.
- Include at least two "fallback" steps: one for a tired or struggling student, one for finishing early.
- Student talk or writing time at least half of the lesson.
- The tutor glances at this during the lesson, so keep it short: about two printed pages in total. Each stage has at most 5 steps; each "say" is at most 3 short sentences; at most 3 expect or probe items per step. Do not script what the materials already contain.`,
  deck: `Slide deck rules (Beamer, 16:9):
- 6–12 frames. Frame titles state the point as a full sentence (≤ 40 characters where possible).
- Each frame has one block (two at most). Budgets: objectives 2–4 items ≤ 70 chars; compare original/revised ≤ 160 chars, one note per [[err:]] in the same order, notes ≤ 60 chars; flow 3–5 steps; cuecard task ≤ 90 chars with 3–4 cues; timed prompt ≤ 220 chars and ≤ 3 phases; reveal ≤ 4 steps ≤ 180 chars; wrapup ≤ 3 summary items, ≤ 2 words, ≤ 3 exit questions; aside ≤ 110 chars.
- Use the student's real sentences in compare blocks. Use reveal only where the student should think before seeing the answer.
- No tutor script on slides; the deck is what the student looks at.
- The LAST frame must be a wrapup frame containing the exit check; no frame after it.
- Hard limits (slides overflow otherwise): titles at most 40 characters (count them); at most about 50 words of visible text per frame; one block per frame unless both are tiny.
- In compare blocks, mark every word that changes: each [[err:…]] in the original has a matching [[fix:…]] in the revision.
- Use an aside only when the student needs a next step; at most one aside per three frames, never repeating the slide.
- Slides are English only: no Chinese or other glosses (the slide fonts cannot show them). Wrap-up words: plain word, IPA without slashes or markup, a short English gloss.`,
} as const;
