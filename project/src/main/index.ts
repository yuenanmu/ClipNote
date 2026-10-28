import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createImportHandler } from './import-controller.ts';
import { createStorageHandlers } from './storage-controller.ts';
import { createReaderHandlers } from './reader-controller.ts';
import { createApiHandlers } from './api-controller.ts';
import { createWorkflowHandlers } from './workflow-controller.ts';
import { createWorkspaceHandler } from './workspace-controller.ts';
import { createBatchHandlers } from './batch-controller.ts';
import { WorkspaceFiles } from '../modules/workspace/files.ts';
import { runAnalysisWorker } from './analysis-task.ts';
import { ApiConfigStore, normalizeBaseUrl } from '../modules/api/config.ts';
import { listModels, resolveModelKey } from '../modules/api/models.ts';
import { createApiAdapter } from '../modules/api/provider.ts';
import { ApiError } from '../modules/api/errors.ts';
import { parseSource } from '../modules/source/parser.ts';
import { planAnalysis } from '../modules/analysis/plan.ts';
import { validateOutline } from '../modules/analysis/validate.ts';
import { NoteCatalog } from '../modules/reader/catalog.ts';
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
    catalog: new NoteCatalog(join(local, 'reader')),
    sourcePath: sourceId => { const source = snapshots.get(sourceId)?.document; return source?.format === 'md' ? source.originalPath : undefined; },
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
  const apiStore = new ApiConfigStore(join(local, 'api'), safeStorage);
  let activeJob: 'single' | 'batch' | undefined, gateBusy = false;
  const workspace = new WorkspaceFiles(join(local, 'workspace'));
  const workspaceHandler = createWorkspaceHandler({ isTrustedSender: trusted, execute: async (kind, action, args) => {
    const type = kind as 'source' | 'notes'; const id = args[0] as string;
    if (action === 'root') return workspace.root(type);
    if (action === 'choose') { const selected = await dialog.showOpenDialog(window, { title: type === 'source' ? '选择资料根目录' : '选择笔记根目录', properties: ['openDirectory', 'createDirectory'] }); return selected.canceled || !selected.filePaths[0] ? undefined : workspace.choose(type, selected.filePaths[0]); }
    if (action === 'list') return workspace.list(type, id, args[1] as number | undefined);
    if (action === 'search') return workspace.search(type, args[0] as string);
    if (action === 'mkdir') return workspace.createDirectory(type, id, args[1] as string);
    if (action === 'create') return workspace.createNote(id, args[1] as string);
    if (action === 'move') return workspace.move(type, id, args[1] as string);
    if (action === 'rename') return workspace.rename(type, id, args[1] as string);
    if (action === 'trash') return workspace.trash(type, id, path => shell.trashItem(path));
    if (action === 'read') return workspace.readNote(id);
    if (action === 'save') return workspace.saveNote(id, args[1] as string, args[2] as string);
    if (action === 'associate') return workspace.associate(id, args[1] as string);
    if (action === 'import') return loadInWorker(await workspace.filePath(type, id));
    throw new Error('Invalid workspace action');
  } });
  ipcMain.handle('workspace:action', async (event, kind, action, ...args) => {
    if (!trusted(event)) return workspaceHandler(event, kind, action, ...args);
    if (!['choose','mkdir','create','move','rename','trash','save','associate'].includes(action)) return workspaceHandler(event, kind, action, ...args);
    if (gateBusy) return { status: 'error', error: { code: 'BUSY', message: '整理任务进行中，请稍后操作文件。' } };
    gateBusy = true;
    try {
      if (await isJobActive(event)) return { status: 'error', error: { code: 'BUSY', message: '整理任务进行中，请稍后操作文件。' } };
      return await workspaceHandler(event, kind, action, ...args);
    } finally { gateBusy = false; }
  });
  const workflowHandlers = createWorkflowHandlers({ isTrustedSender: trusted, source: id => snapshots.get(id), credentials: () => apiStore.credentials(),
    hasDirectory: async () => Boolean((await tasks.run(join(__dirname, 'storage-worker.cjs'), { stateDir: join(local, 'storage'), action: 'state', payload: {} }, true)).directory),
    analyze: (source, credentials, options) => runAnalysisWorker(join(__dirname, 'analysis-worker.cjs'), source, credentials, options),
    save: (source, result) => tasks.run(join(__dirname, 'storage-worker.cjs'), { stateDir: join(local, 'storage'), action: 'save-generated', payload: { snapshot: source, markdown: result.markdown, metadata: { kind: 'generated-note', provider: result.attempt.provider, model: result.attempt.model, promptVersion: result.attempt.promptVersion, sourceRefs: result.sourceRefs } } }, true),
    resume: draftId => tasks.run(join(__dirname, 'storage-worker.cjs'), { stateDir: join(local, 'storage'), action: 'resume', payload: { draftId } }, true),
  });
  const batchHandlers = createBatchHandlers({ isTrustedSender: trusted,
    config: async () => { const value = await apiStore.state(); if (!value.configured) throw new ApiError('INVALID_CONFIG'); return value; },
    preview: (id, target) => workspace.previewOutput(id, target),
    analyze: async (id, expected, signal) => { const credentials = await apiStore.credentials(); if (credentials.baseUrl !== expected.baseUrl || credentials.model !== expected.model) throw new ApiError('INVALID_CONFIG');
      const source = await tasks.run(join(__dirname, 'source-worker.cjs'), { filePath: await workspace.filePath('source', id) });
      return runAnalysisWorker(join(__dirname, 'analysis-worker.cjs'), source.document, credentials, { signal, instructions: expected.instructions }); },
    save: (id, target, plan, markdown) => workspace.writeOutput(id, target, plan, markdown),
  });
  async function isJobActive(event: unknown): Promise<boolean> {
    if (!activeJob) return false; const response = activeJob === 'single' ? await workflowHandlers.state(event) : await batchHandlers.state(event);
    if (response.status === 'ok' && ['running','saving'].includes(response.value.status)) return true;
    activeJob = undefined; return false;
  }
  const guarded = async (event: unknown, type: 'single' | 'batch', run: () => Promise<any>) => {
    if (!trusted(event) || gateBusy) return { status: 'error', error: { code: 'BUSY', message: '已有整理任务正在进行。' } };
    gateBusy = true; try { if (await isJobActive(event)) return { status: 'error', error: { code: 'BUSY', message: '已有整理任务正在进行。' } };
      activeJob = type; const result = await run(); if (result.status !== 'ok' || !['running','saving'].includes(result.value.status)) activeJob = undefined; return result;
    } finally { gateBusy = false; }
  };
  for (const [action, handler] of Object.entries(workflowHandlers)) ipcMain.handle(`workflow:${action}`, action === 'start' || action === 'retry' ? (event, ...args) => guarded(event, 'single', () => handler(event, ...args)) : handler);
  for (const [action, handler] of Object.entries(batchHandlers)) ipcMain.handle(`batch:${action}`, action === 'start' || action === 'retry' ? (event, ...args) => guarded(event, 'batch', () => handler(event, ...args)) : handler);
  const apiHandlers = createApiHandlers({ isTrustedSender: trusted, store: apiStore, models: async (input, signal) => {
    const baseUrl = normalizeBaseUrl(input.baseUrl); const key = await resolveModelKey(apiStore, baseUrl, input.apiKey);
    return listModels(baseUrl, key, signal);
  }, test: async signal => {
    const credentials = await apiStore.credentials();
    const source = parseSource(Buffer.from('ClipNote 合成连接测试。'), '测试.txt');
    const profile = { provider: 'api', model: credentials.model, promptVersion: 't06-v1', inputCharBudget: 2000, outputCharBudget: 64000, overlapChars: 0 };
    const chunk = planAnalysis(source, profile).chunks[0];
    const result = await createApiAdapter(credentials)({ chunk, profile, signal, repair: false });
    if (result.status === 'truncated') throw new ApiError('TRUNCATED');
    try { validateOutline(typeof result.value === 'string' ? JSON.parse(result.value) : result.value, source, chunk); } catch { throw new ApiError('INVALID_RESPONSE'); }
  } });
  for (const [action, handler] of Object.entries(apiHandlers)) ipcMain.handle(`api:${action}`, handler);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    ipcMain.removeHandler('source:import');
    for (const action of Object.keys(storageHandlers)) ipcMain.removeHandler(`storage:${action}`);
    for (const action of Object.keys(readerHandlers)) ipcMain.removeHandler(`reader:${action}`);
    for (const action of Object.keys(apiHandlers)) ipcMain.removeHandler(`api:${action}`);
    for (const action of Object.keys(workflowHandlers)) ipcMain.removeHandler(`workflow:${action}`);
    for (const action of Object.keys(batchHandlers)) ipcMain.removeHandler(`batch:${action}`);
    ipcMain.removeHandler('workspace:action');
    tasks.stop(); snapshots.clear();
  });
  void window.loadFile(join(__dirname, '../renderer/index.html'));
}).catch(() => { app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => tasks.stop());
}
