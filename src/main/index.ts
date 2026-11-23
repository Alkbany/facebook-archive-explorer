import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { openAppDatabase } from './database/connection';
import { DATABASE_MIGRATIONS } from './database/migrations';
import { registerIpcHandlers } from './ipc/register-handlers';

let mainWindow: BrowserWindow | null = null;
const database = openAppDatabase(
  join(app.getPath('userData'), 'data', 'facebook-archive-explorer.sqlite'),
  DATABASE_MIGRATIONS
);

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f6fa',
    title: 'Facebook Archive Explorer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const developmentOrigin = rendererUrl ? new URL(rendererUrl).origin : null;

  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (developmentOrigin) {
      try {
        if (new URL(targetUrl).origin === developmentOrigin) return;
      } catch {
        // Invalid navigation URLs are denied below.
      }
    } else if (targetUrl === window.webContents.getURL()) {
      return;
    }

    event.preventDefault();
  });

  if (rendererUrl) void window.loadURL(rendererUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  mainWindow = window;
  return window;
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.alkbany.facebookarchiveexplorer');
  registerIpcHandlers(database);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}).catch((error: unknown) => {
  console.error('Application startup failed.', error);
  app.quit();
});

app.on('before-quit', () => {
  if (database.isOpen) database.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
