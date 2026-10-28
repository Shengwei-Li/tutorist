import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, nativeTheme, type BrowserWindow } from 'electron';

/**
 * Self-driving smoke run (TUTORDESK_SMOKE_DIR=<dir>): exercises the real app through its UI and
 * saves screenshots plus a JSON report, then quits. With TUTORDESK_FAKE_AI=1 it also walks the
 * lesson workbench and the essay review end to end.
 */
export async function runSmoke(win: BrowserWindow, outDir: string): Promise<void> {
  const wc = win.webContents;
  const report: { step: string; ok: boolean; note?: string }[] = [];
  await mkdir(outDir, { recursive: true });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const js = <T = unknown>(code: string) => wc.executeJavaScript(code, true) as Promise<T>;
  const shot = async (name: string) => {
    // Windows behind other windows are not repainted; force a fresh frame before capturing.
    wc.invalidate();
    await wait(700);
    wc.invalidate();
    await wait(300);
    await writeFile(path.join(outDir, `${name}.png`), (await wc.capturePage()).toPNG());
  };
  const q = (testId: string) => `document.querySelector('[data-testid="${testId}"]')`;
  const click = (testId: string) => js(`(() => { const el = ${q(testId)}; if (!el) throw new Error('missing ${testId}'); el.click(); })()`);
  const type = (testId: string, value: string) =>
    js(`(() => {
      const el = ${q(testId)};
      if (!el) throw new Error('missing ${testId}');
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    })()`);
  const until = async (expr: string, timeoutMs: number) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await js<boolean>(`!!(${expr})`)) return true;
      await wait(250);
    }
    return false;
  };
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const r = await fn();
      report.push({ step: name, ok: r !== false });
    } catch (e) {
      report.push({ step: name, ok: false, note: (e as Error).message });
    }
  };
  const fake = process.env.TUTORDESK_FAKE_AI === '1';

  await wait(1500);
  await step('today', () => shot('01-today'));
  await step('add student', async () => {
    await click('nav-students');
    // The first student opens the "describe to AI" view; this run fills the form instead.
    await until(q('intake-manual'), 5000);
    await click('intake-manual');
    await until(q('student-name'), 5000);
    await type('student-name', 'Mina Park');
    await click('student-create');
    const ok = await until(q('lesson-new'), 10_000);
    await shot('02-student');
    return ok;
  });
  await step('add lesson', async () => {
    await click('lesson-new');
    await until(q('lesson-topic'), 5000);
    await type('lesson-topic', 'Task 2 position');
    await click('lesson-save');
    return until(q('open-lesson-1'), 5000);
  });

  if (fake) {
    await step('lesson: draft plan', async () => {
      await click('open-lesson-1');
      await until(q('thread-input'), 5000);
      // The agent thread (a scripted model in fake mode) calls the real TutorDesk tools.
      await type('thread-input', 'Plan this lesson. Her intros never state a position; work on that.');
      await click('thread-send');
      const ok = (await until(q('plan-total'), 30_000)) && (await until(`!${q('thread-stop')}`, 30_000));
      await shot('03-plan');
      return ok;
    });
    await step('lesson: approve and write materials', async () => {
      await click('approve-plan');
      await until(q('write-materials'), 5000);
      await click('write-materials');
      await until(q('thread-stop'), 5000);
      // Four documents, each checked and typeset by save_artifact.
      const ok = await until(`!${q('thread-stop')}`, 240_000);
      await wait(800);
      await shot('04-generated');
      return ok && (await js<boolean>(`!!document.querySelector('[data-testid="tab-deck"] svg, [data-testid="tab-deck"] span')`));
    });
    for (const [kind, name] of [['handout', '05-handout'], ['worksheet', '06-worksheet'], ['deck', '07-deck']] as const) {
      await step(`lesson: view ${kind}`, async () => {
        await click(`tab-${kind}`);
        const ok = await until(q('pdf'), 60_000);
        await wait(1800);
        await shot(name);
        return ok;
      });
    }
    await step('lesson: teacher edition', async () => {
      await click('tab-worksheet');
      await until(q('edition'), 5000);
      await type('edition', 'teacher');
      await wait(300);
      const ok = await until(q('pdf'), 60_000);
      await wait(2500);
      await shot('08-worksheet-teacher');
      return ok;
    });
    await step('essay: paste and review', async () => {
      await click('nav-students');
      await until(q('essay-paste'), 5000);
      await click('essay-paste');
      await type('essay-prompt', 'Some people think longer prison sentences are the best way to reduce crime. To what extent do you agree?');
      await type(
        'essay-new-text',
        'Nowadays, with the development of society, more and more people think crime is a big problem. Some people think that the best way is longer prison sentences.\n\nAlthough longer prison sentences can scare criminals, but it also has some problems. Many people which are poor will steal things. This is very important for society and very important for people.\n\nIn a word, longer sentences have advantages and disadvantages, but education is most important.',
      );
      await click('essay-save');
      await until(q('review-essay'), 5000);
      await click('review-essay');
      const ok = await until(q('finalise'), 30_000);
      await shot('09-essay-review');
      return ok;
    });
    await step('essay: finalise', async () => {
      await click('finalise');
      await wait(1500);
      return true;
    });
  }

  await step('student: edit profile', async () => {
    await click('nav-students');
    await until(q('profile-edit'), 5000);
    await click('profile-edit');
    await until(q('profile-name'), 5000);
    await wait(1000);
    await shot('12-profile-edit');
    await type('profile-name', 'Mina Park (Sat)');
    await click('profile-save');
    return until(`[...document.querySelectorAll('h1')].some((h) => h.textContent === 'Mina Park (Sat)')`, 5000);
  });
  await step('student: plan ahead and delete a lesson', async () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    const ahead = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await click('lesson-new');
    await until(q('lesson-date'), 5000);
    await type('lesson-date', ahead);
    await type('lesson-topic', 'Speaking part 2');
    await click('lesson-save');
    if (!(await until(q('open-lesson-2'), 5000))) return false;
    await click('lesson-menu-2');
    await wait(200);
    await shot('13-lesson-menu');
    await click('lesson-delete');
    await until(q('confirm-delete'), 5000);
    await shot('14-lesson-delete');
    await click('confirm-delete');
    const gone = await until(`!${q('open-lesson-2')}`, 5000);
    // Plan the lesson again so Today shows something coming up.
    await click('lesson-new');
    await until(q('lesson-date'), 5000);
    await type('lesson-date', ahead);
    await type('lesson-topic', 'Speaking part 2');
    await click('lesson-save');
    await until(q('open-lesson-2'), 5000);
    await shot('15-student');
    return gone;
  });
  await step('today: upcoming', async () => {
    await click('nav-today');
    const ok = await until(q('today-lesson-mina-park-ielts-2'), 10_000);
    await shot('16-today');
    return ok;
  });

  if (fake) {
    const h1 = (text: string) => `[...document.querySelectorAll('h1')].some((h) => h.textContent === ${JSON.stringify(text)})`;
    const ask = async (text: string) => {
      // The agent controls appear once the conversation has loaded.
      await until(q('agent-mode'), 10_000);
      await type('thread-input', text);
      await click('thread-send');
    };
    await step('ai: describe a new student', async () => {
      await click('nav-students');
      await until(q('student-add'), 5000);
      await click('student-add');
      await until(q('intake-ai'), 5000);
      await click('intake-ai');
      await until(q('thread-input'), 5000);
      await shot('17-intake');
      await ask('Wang Yiran, Year 11, IELTS 6.5 in about ten weeks, weakest in writing, online twice a week for 90 minutes, loves basketball.');
      const ok = (await until(q('proposal-student'), 30_000)) && (await until(`!${q('thread-stop')}`, 30_000));
      await wait(500);
      await shot('18-intake-card');
      await click('proposal-confirm');
      return ok && (await until(h1('Wang Yiran'), 10_000)) && (await until(q('open-lesson-2'), 5000));
    });
    await step('ai: schedule lessons', async () => {
      await click('assistant-open');
      await until(q('thread-input'), 5000);
      await ask('Schedule her next lessons.');
      const ok = (await until(q('proposal-lessons'), 30_000)) && (await until(`!${q('thread-stop')}`, 30_000));
      await wait(500);
      await shot('19-assistant-lessons');
      await click('proposal-confirm');
      return ok && (await until(q('open-lesson-5'), 10_000));
    });
    await step('ai: update the profile', async () => {
      await ask('Her target is 7 now and she likes films too.');
      const ok = (await until(q('proposal-profile'), 30_000)) && (await until(`!${q('thread-stop')}`, 30_000));
      await wait(500);
      await shot('20-assistant-profile');
      await click('proposal-confirm');
      return ok && (await until(`!${q('proposal-profile')} && document.body.innerText.includes('IELTS Academic · 7')`, 10_000));
    });
  }

  await step('settings', async () => {
    await click('nav-settings');
    const ok = await until(q('claude-checked'), 30_000);
    await shot('10-settings');
    return ok;
  });
  await step('dark mode', async () => {
    nativeTheme.themeSource = 'dark';
    await click('nav-today');
    await wait(1500);
    await shot('11-dark-today');
  });

  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
}
