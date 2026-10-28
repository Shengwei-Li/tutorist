import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, nativeTheme, session, shell } from 'electron';
import { applyZoom, closeThreads, registerIpc } from './services.js';
import { loadSettings } from './settings.js';
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
  // The tutor's interface size, on every load (a reload resets Chromium's zoom).
  win.webContents.on('did-finish-load', () => void loadSettings().then((s) => applyZoom(s.uiScale)));
  // External links open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // The window only ever shows the app itself: the dev server in development, index.html when built.
  const indexFile = path.join(import.meta.dirname, '../renderer/index.html');
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppPage(url, indexFile)) e.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(indexFile);
  return win;
}

function isAppPage(url: string, indexFile: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev && !app.isPackaged) return u.origin === new URL(dev).origin;
  return u.protocol === 'file:' && path.resolve(fileURLToPath(u)) === path.resolve(indexFile);
}

/**
 * Electron grants every permission unless told otherwise. The app needs only the microphone (voice
 * input, audio only, for the app's own page) and full screen (the PDF viewer); everything else is
 * refused: camera, screen capture, location, notifications, USB, serial, HID.
 */
function restrictPermissions(indexFile: string): void {
  const ses = session.defaultSession;
  const appPage = (url: string | undefined) => !!url && isAppPage(url, indexFile);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'fullscreen') return callback(true);
    if (permission === 'media') {
      const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
      return callback(appPage(details.requestingUrl) && types.length > 0 && types.every((t) => t === 'audio'));
    }
    callback(false);
  });
  ses.setPermissionCheckHandler((wc, permission, _origin, details) => {
    if (permission === 'fullscreen') return true;
    if (permission === 'media') return details.mediaType !== 'video' && appPage(details.requestingUrl ?? wc?.getURL());
    return false;
  });
  ses.setDevicePermissionHandler(() => false);
}

app.whenReady().then(() => {
  restrictPermissions(path.join(import.meta.dirname, '../renderer/index.html'));
  registerIpc();
  const win = createWindow();
  if (smokeDir) win.webContents.once('did-finish-load', () => void runSmoke(win, smokeDir));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Agent processes must not outlive the app: wait for them (and the turn's saved entries) before quitting.
let threadsClosed = false;
app.on('before-quit', (e) => {
  if (threadsClosed) return;
  e.preventDefault();
  threadsClosed = true;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000));
  void Promise.race([closeThreads().catch(() => {}), timeout]).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
