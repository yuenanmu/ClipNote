import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createImportHandler } from './import-controller.ts';
import { createStorageHandlers } from './storage-controller.ts';
import { createReaderHandlers } from './reader-controller.ts';
import { readBytes } from '../modules/storage/io.ts';
import { WorkerTasks } from './worker-tasks.ts';
import { StorageError } from '../modules/storage/errors.ts';
import type { SourceDocument } from '../contracts/source.ts';
import type { SourceSnapshot } from '../contracts/source.ts';

const projectRoot = resolve(__dirname, '../../..');
const testRoot = join(projectRoot, '.local/test-artifacts');
const requestedProfile = process.env.CLIPNOTE_TEST_USER_DATA;
const local = requestedProfile ? resolve(requestedProfile) : join(projectRoot, '.local/desktop');
if (requestedProfile && !local.startsWith(testRoot + sep)) throw new Error('Test profile must be inside test artifacts');
mkdirSync(local, { recursive: true });
app.setPath('userData', local);
app.setPath('logs', join(local, 'logs'));
app.setName('ClipNote');
const tasks = new WorkerTasks(), snapshots = new Map<string, SourceSnapshot>();
function remember(snapshot: SourceSnapshot): SourceDocument {
  snapshots.delete(snapshot.document.sourceId); snapshots.set(snapshot.document.sourceId, snapshot);
  while (snapshots.size > 5) snapshots.delete(snapshots.keys().next().value!);
  return snapshot.document;
}

async function loadInWorker(filePath: string): Promise<SourceDocument> { return remember(await tasks.run(join(__dirname, 'source-worker.cjs'), { filePath })); }

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else {
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
});
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
  const trusted = (event: unknown) => { const request = event as IpcMainInvokeEvent; return !window.isDestroyed() && request.sender === window.webContents && request.senderFrame === window.webContents.mainFrame; };
  ipcMain.handle('source:import', createImportHandler({
    isTrustedSender: trusted,
    chooseFile: async () => {
      const selected = await dialog.showOpenDialog(window, {
        title: '导入字幕或文本', properties: ['openFile'],
        filters: [{ name: '字幕与文本', extensions: ['srt', 'vtt', 'txt', 'md'] }],
      });
      return selected.canceled ? undefined : selected.filePaths[0];
    },
    loadFile: loadInWorker,
  }));
  const storageHandlers = createStorageHandlers({
    isTrustedSender: trusted,
    chooseDirectory: async () => {
      const selected = await dialog.showOpenDialog(window, { title: '选择来源与版本保存位置', properties: ['openDirectory', 'createDirectory'] });
      if (selected.canceled) return undefined;
      const parent = selected.filePaths[0];
      if (!parent) return undefined;
      const absolute = resolve(parent);
      if ((absolute === projectRoot || absolute.startsWith(projectRoot + sep)) && !absolute.startsWith(join(projectRoot, '.local') + sep) && !absolute.startsWith(join(projectRoot, '.runtime') + sep)) throw new StorageError('UNSAFE_PATH');
      return parent;
    },
    execute: async (action, args) => {
      let payload: unknown = {};
      if (action === 'choose') payload = { parent: args[0] };
      if (action === 'save') { const snapshot = snapshots.get(args[0] as string); if (!snapshot) throw new StorageError('INVALID_REQUEST'); payload = { snapshot }; }
      if (action === 'resume') payload = { draftId: args[0] };
      if (action === 'open') payload = { sourceId: args[0], revisionId: args[1] };
      const value = await tasks.run(join(__dirname, 'storage-worker.cjs'), { stateDir: join(local, 'storage'), action, payload }, true);
      if (action === 'open') return { document: remember(value.snapshot), revision: value.revision };
      return value;
    },
  });
  for (const [action, handler] of Object.entries(storageHandlers)) ipcMain.handle(`storage:${action}`, handler);
  const readerHandlers = createReaderHandlers({
    isTrustedSender: trusted,
    chooseFile: async () => {
      const selected = await dialog.showOpenDialog(window, { title: '打开 Markdown', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] });
      return selected.canceled ? undefined : selected.filePaths[0];
    },
    load: target => tasks.run(join(__dirname, 'reader-worker.cjs'), { stateDir: join(local, 'storage'), target }, 'reader'),
    openFile: async path => { await readBytes(path, 2 * 1024 * 1024); return shell.openPath(path); },
    openLink: url => shell.openExternal(url),
  });
  for (const [action, handler] of Object.entries(readerHandlers)) ipcMain.handle(`reader:${action}`, handler);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    ipcMain.removeHandler('source:import');
    for (const action of Object.keys(storageHandlers)) ipcMain.removeHandler(`storage:${action}`);
    for (const action of Object.keys(readerHandlers)) ipcMain.removeHandler(`reader:${action}`);
    tasks.stop(); snapshots.clear();
  });
  void window.loadFile(join(__dirname, '../renderer/index.html'));
}).catch(() => { app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => tasks.stop());
}
