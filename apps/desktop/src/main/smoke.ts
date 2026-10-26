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
    await until(q('student-name'), 5000);
    await type('student-name', 'Mina Park');
    await click('student-create');
    const ok = await until(q('lesson-create'), 10_000);
    await shot('02-student');
    return ok;
  });
  await step('add lesson', async () => {
    await type('lesson-topic', 'Task 2 position');
    await click('lesson-create');
    return until(q('open-lesson-1'), 5000);
  });

  if (fake) {
    await step('lesson: draft plan', async () => {
      await click('open-lesson-1');
      await until(q('make-plan'), 5000);
      await type('lesson-brief', 'Work on stating a clear position in the introduction.');
      await click('make-plan');
      const ok = await until(q('plan-total'), 30_000);
      await shot('03-plan');
      return ok;
    });
    await step('lesson: approve and generate', async () => {
      await click('approve-plan');
      // Four documents, each compiled during QA.
      const ok = await until(`${q('run-log')} && ${q('run-log')}.innerText.includes('save · deck') && !${q('run-log')}.innerText.includes('◐')`, 240_000);
      await wait(800);
      await shot('04-generated');
      return ok;
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
