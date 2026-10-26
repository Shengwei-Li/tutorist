import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, nativeTheme, type BrowserWindow } from 'electron';

/**
 * Self-driving smoke run (TUTORDESK_SMOKE_DIR=<dir>): exercises the real app through its UI and
 * saves screenshots plus a JSON report, then quits. Used to verify builds without a human.
 */
export async function runSmoke(win: BrowserWindow, outDir: string): Promise<void> {
  const wc = win.webContents;
  const report: { step: string; ok: boolean; note?: string }[] = [];
  await mkdir(outDir, { recursive: true });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const js = <T = unknown>(code: string) => wc.executeJavaScript(code, true) as Promise<T>;
  const shot = async (name: string) => {
    await wait(400);
    await writeFile(path.join(outDir, `${name}.png`), (await wc.capturePage()).toPNG());
  };
  const click = (testId: string) =>
    js(`(() => { const el = document.querySelector('[data-testid="${testId}"]'); if (!el) throw new Error('missing ${testId}'); el.click(); })()`);
  const type = (testId: string, value: string) =>
    js(`(() => {
      const el = document.querySelector('[data-testid="${testId}"]');
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
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

  await wait(1500);
  await step('today', () => shot('01-today'));
  await step('add student', async () => {
    await click('nav-students');
    await until(`document.querySelector('[data-testid="student-name"]')`, 5000);
    await type('student-name', 'Mina Park');
    await click('student-create');
    const ok = await until(`document.querySelector('[data-testid="lesson-create"]')`, 10_000);
    await shot('02-student');
    return ok;
  });
  await step('add lesson', async () => {
    await type('lesson-topic', 'Task 2 · PEEL paragraphs');
    await click('lesson-create');
    await wait(1500);
    await shot('03-lesson');
  });
  await step('settings + health', async () => {
    await click('nav-settings');
    const ok = await until(`document.querySelector('[data-testid="claude-checked"]')`, 30_000);
    await shot('04-settings');
    return ok;
  });
  for (const [doc, name] of [['handout', '05-handout'], ['deck', '06-deck']] as const) {
    await step(`compile ${doc}`, async () => {
      await type('compile-doc', doc);
      await wait(200);
      await click('compile');
      await wait(500);
      const done = await until(`document.querySelector('[data-testid="compile-result"]') && !document.querySelector('[data-testid="compile"]').disabled`, 90_000);
      const ok = await js<boolean>(`document.querySelector('[data-testid="compile-result"]')?.dataset.ok === 'true'`);
      await js(`document.querySelector('iframe')?.scrollIntoView()`);
      await wait(1500);
      await shot(name);
      return done && ok;
    });
  }
  await step('dark mode', async () => {
    nativeTheme.themeSource = 'dark';
    await click('nav-students');
    await wait(800);
    await shot('07-dark-students');
    await click('nav-today');
    await wait(1500);
    await shot('08-dark-today');
  });

  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
}
