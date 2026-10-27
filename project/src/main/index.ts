import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createImportHandler } from './import-controller.ts';
import { SourceImportError } from '../modules/source/errors.ts';
import type { SourceDocument } from '../contracts/source.ts';

const local = resolve(__dirname, '../../../.local/desktop');
mkdirSync(local, { recursive: true });
app.setPath('userData', local);
app.setPath('logs', join(local, 'logs'));
app.setName('ClipNote');
const workers = new Set<Worker>();

function loadInWorker(filePath: string): Promise<SourceDocument> {
  return new Promise((resolveDocument, reject) => {
    const worker = new Worker(join(__dirname, 'source-worker.cjs'), { workerData: { filePath } });
    workers.add(worker);
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Import timed out')), 30_000);
    function finish(error?: Error, document?: SourceDocument) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      workers.delete(worker);
      void worker.terminate();
      if (error) reject(error); else resolveDocument(document!);
    }
    worker.once('message', result => {
      if (result.ok) finish(undefined, result.document);
      else finish(new SourceImportError(result.code));
    });
    worker.once('error', error => finish(error));
    worker.once('exit', () => { if (!settled) finish(new Error('Import worker exited')); });
  });
}

app.whenReady().then(() => {
  const window = new BrowserWindow({
    title: 'ClipNote', width: 1280, height: 860, minWidth: 980, minHeight: 680,
    backgroundColor: '#f6f7f9', show: false, autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  ipcMain.handle('source:import', createImportHandler({
    isTrustedSender: event => {
      const request = event as IpcMainInvokeEvent;
      return !window.isDestroyed() && request.sender === window.webContents && request.senderFrame === window.webContents.mainFrame;
    },
    chooseFile: async () => {
      const selected = await dialog.showOpenDialog(window, {
        title: '导入字幕或文本', properties: ['openFile'],
        filters: [{ name: '字幕与文本', extensions: ['srt', 'vtt', 'txt', 'md'] }],
      });
      return selected.canceled ? undefined : selected.filePaths[0];
    },
    loadFile: loadInWorker,
  }));
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    ipcMain.removeHandler('source:import');
    for (const worker of workers) void worker.terminate();
    workers.clear();
  });
  void window.loadFile(join(__dirname, '../renderer/index.html'));
}).catch(() => { app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { for (const worker of workers) void worker.terminate(); });
