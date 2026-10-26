import path from 'node:path';
import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { registerIpc } from './services.js';
import { runSmoke } from './smoke.js';

const smokeDir = process.env.TUTORDESK_SMOKE_DIR ? path.resolve(process.env.TUTORDESK_SMOKE_DIR) : undefined;
if (smokeDir) app.setPath('userData', path.join(smokeDir, 'userData'));

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'TutorDesk',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111315' : '#fafaf9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Built-in PDF viewer for compiled handouts and decks.
      plugins: true,
      // Smoke runs capture screenshots while the window may be in the background.
      backgroundThrottling: !smokeDir,
    },
  });
  win.once('ready-to-show', () => win.show());
  // External links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file:')) e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  return win;
}

app.whenReady().then(() => {
  registerIpc();
  const win = createWindow();
  if (smokeDir) win.webContents.once('did-finish-load', () => void runSmoke(win, smokeDir));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
