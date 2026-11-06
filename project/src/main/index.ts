import { app, BrowserWindow, dialog, ipcMain, shell, safeStorage, session } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createImportHandler } from './import-controller.ts';
import { createStorageHandlers } from './storage-controller.ts';
import { createReaderHandlers } from './reader-controller.ts';
import { createApiHandlers } from './api-controller.ts';
import { createSubscriptionTask } from './subscription-task.ts';
import { analyzeSubscription } from '../modules/subscription/analyze.ts';
import { createSubscriptionHandlers } from './subscription-controller.ts';
import { createSubscriptionFetch } from '../modules/subscription/transport.ts';
import { createChatGPT } from '../../vendor/siwc/src/index.ts';
import { setSubscriptionTransport } from '../../vendor/siwc/src/transport.ts';
import { createWorkflowHandlers } from './workflow-controller.ts';
import { createWorkspaceHandler } from './workspace-controller.ts';
import { createBatchHandlers } from './batch-controller.ts';
import { createSmartSubDiscoveryHandlers } from './smartsub-controller.ts';
import { createSmartSubTaskHandlers } from './smartsub-task-controller.ts';
import { findSmartSub,invokeSmartSub } from '../modules/smartsub/cli.ts';
import { SmartSubTasks } from '../modules/smartsub/tasks.ts';
import { inspectSmartSub } from '../modules/smartsub/readiness.ts';
import {SmartSubPreferences} from '../modules/smartsub/preferences.ts';
import {createSmartSubPreferencesHandlers} from './smartsub-preferences-controller.ts';
import { TranscriptionTasks } from '../modules/smartsub/transcription-tasks.ts';
import { BatchReuse } from '../modules/api/batch-reuse.ts';
import { WorkspaceFiles } from '../modules/workspace/files.ts';
import { WorkspaceError } from '../modules/workspace/files.ts';
import { NoteResults } from '../modules/workspace/results.ts';
import { ArchiveExporter } from '../modules/workspace/archive-export.ts';
import { StorageService } from '../modules/storage/service.ts';
import { runAnalysisWorker } from './analysis-task.ts';
import { ApiConfigStore, normalizeBaseUrl } from '../modules/api/config.ts';
import { listModels, resolveModelKey } from '../modules/api/models.ts';
import { createApiAdapter } from '../modules/api/provider.ts';
import { ApiError } from '../modules/api/errors.ts';
import { parseSource } from '../modules/source/parser.ts';
import { planAnalysis } from '../modules/analysis/plan.ts';
import { validateOutline } from '../modules/analysis/validate.ts';
import { NoteCatalog } from '../modules/reader/catalog.ts';
import { readBytes,isUuid,exists,readJson,writeAtomic,digest } from '../modules/storage/io.ts';
import { WorkerTasks } from './worker-tasks.ts';
import { StorageError } from '../modules/storage/errors.ts';
import type { SourceDocument } from '../contracts/source.ts';
import type { SourceSnapshot } from '../contracts/source.ts';
import type {AnalysisMetrics} from '../contracts/analysis.ts';

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
  window.webContents.on('will-prevent-unload',event=>{const response=dialog.showMessageBoxSync(window,{type:'question',title:'未保存的笔记',message:'笔记还有未保存的修改，是否放弃修改并退出？',buttons:['继续编辑','放弃并退出'],defaultId:0,cancelId:0});if(response===1)event.preventDefault();});
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const trusted = (event: unknown) => { const request = event as IpcMainInvokeEvent; return !window.isDestroyed() && request.sender === window.webContents && request.senderFrame === window.webContents.mainFrame; };
  const subscriptionSession = session.fromPartition('clipnote-subscription');
  setSubscriptionTransport(createSubscriptionFetch(subscriptionSession.fetch.bind(subscriptionSession) as typeof fetch));
  const subscription = createChatGPT({
    appName:'ClipNote', appId:'clipnote', redirectPort:0, storageDir:join(local,'subscription'),
    credentialEncryption:{id:'electron-safe-storage-v1', isAvailable:()=>safeStorage.isEncryptionAvailable(), encrypt:value=>safeStorage.encryptString(value), decrypt:value=>safeStorage.decryptString(Buffer.from(value))},
    openBrowser:async value=>{const url=new URL(value);if(url.origin!=='https://auth.openai.com')throw new Error('Unexpected sign-in destination');await shell.openExternal(url.href);},
  });
  const subscriptionHandlers = createSubscriptionHandlers(subscription, trusted);
  for (const [action, handler] of Object.entries(subscriptionHandlers)) ipcMain.handle(`subscription:${action}`, handler);
  const smartsubConfig=join(local,'smartsub','settings.json');
  const smartsubHandlers=createSmartSubDiscoveryHandlers({isTrustedSender:trusted,find:findSmartSub,
    load:async()=>{if(!await exists(smartsubConfig))return undefined;const value=await readJson(smartsubConfig);if(value.version!==1 || typeof value.path!=='string' || Object.keys(value).sort().join(',')!=='path,version')throw new Error('Invalid configuration');return value.path;},
    save:path=>writeAtomic(smartsubConfig,{version:1,path}),
    candidates:()=>{if(requestedProfile){const candidate=process.env.CLIPNOTE_TEST_SMARTSUB_ROOT;return candidate && resolve(candidate).startsWith(local+sep)?[candidate]:[];}return [process.env.CLIPNOTE_SMARTSUB_DIR,process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA,'Programs','SmartSub'),process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA,'SmartSub'),process.env.ProgramFiles && join(process.env.ProgramFiles,'SmartSub')].filter((path):path is string=>Boolean(path));},
    choose:async()=>{const value=await dialog.showOpenDialog(window,{title:'选择 SmartSub 安装文件夹',properties:['openDirectory']});return value.canceled?undefined:value.filePaths[0];},
    openOfficial:()=>shell.openExternal('https://github.com/buxuku/SmartSub/releases/latest'),
  });
  for(const [action,handler] of Object.entries(smartsubHandlers))ipcMain.handle(`smartsub:${action}`,handler);
  const importHandler=createImportHandler({
    isTrustedSender: trusted,
    chooseFile: async () => {
      const selected = await dialog.showOpenDialog(window, {
        title: '导入字幕或文本', properties: ['openFile'],
        filters: [{ name: '字幕与文本', extensions: ['srt', 'vtt', 'txt', 'md'] }],
      });
      return selected.canceled ? undefined : selected.filePaths[0];
    },
    loadFile: loadInWorker,
  });
  ipcMain.handle('source:import',async(event,...args)=>{const result=await importHandler(event,...args);if(result.status!=='imported')return result;try{return {...result,entryId:(await workspace.registerSource(result.document.originalPath)).id};}catch{return {status:'error',error:{code:'IMPORT_FAILED',message:'无法打开所选资料，请检查文件。'}};}});
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
    workspacePath:id=>workspace.filePath('notes',id),
    isTrustedSender: trusted,
    chooseFile: async () => {
      const selected = await dialog.showOpenDialog(window, { title: '打开 Markdown', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md'] }] });
      return selected.canceled ? undefined : selected.filePaths[0];
    },
    load: target => tasks.run(join(__dirname, 'reader-worker.cjs'), { stateDir: join(local, 'storage'), target }, 'reader'),
    openFile: async path => { await readBytes(path, 2 * 1024 * 1024); return shell.openPath(path); },
    openLink: url => shell.openExternal(url),
  });
  let readerRequests:Promise<unknown>=Promise.resolve();
  for (const [action, handler] of Object.entries(readerHandlers)) ipcMain.handle(`reader:${action}`,(event,...args)=>{const operation=readerRequests.then(()=>handler(event,...args));readerRequests=operation.catch(()=>{});return operation;});
  const apiStore = new ApiConfigStore(join(local, 'api'), safeStorage);
  let activeJob: 'single' | 'batch' | 'subscription' | undefined, gateBusy = false;
  const workspace = new WorkspaceFiles(join(local, 'workspace'));
  const smartsubInstallation=async()=>{
    const found=await smartsubHandlers.state({sender:window.webContents,senderFrame:window.webContents.mainFrame});
    if(found.status!=='ok' || !found.value.installed)throw new Error('没有找到可用的 SmartSub 程序和 CLI。');
    const install=await findSmartSub([found.value.path]);if(!install)throw new Error('SmartSub 安装不可访问。');
    return install;
  };
  const identityFor=async(install:Awaited<ReturnType<typeof smartsubInstallation>>)=>{const value=await invokeSmartSub(install,'system.info',{});if(!value || typeof value!=='object' || typeof (value as any).profile!=='string' || !(value as any).profile)throw new Error('无法确认 SmartSub 后台身份。');return digest(JSON.stringify([install.root.toLowerCase(),resolve((value as any).profile).toLowerCase()]));};
  const smartsubInvoke=async(operation:string,input:unknown)=>invokeSmartSub(await smartsubInstallation(),operation,input);
  const smartsubConnection=async()=>{const install=await smartsubInstallation();return {identity:await identityFor(install),invoke:(operation:string,input:unknown)=>invokeSmartSub(install,operation,input)};};
  const smartsubTasks=new SmartSubTasks(join(local,'smartsub'),smartsubInvoke,smartsubConnection);
  const smartsubPreferences=new SmartSubPreferences(join(local,'smartsub','transcription-settings.json'),smartsubInvoke);
  const preferenceHandlers=createSmartSubPreferencesHandlers(trusted,smartsubPreferences);
  for(const [action,handler] of Object.entries(preferenceHandlers))ipcMain.handle(`smartsub-preferences:${action}`,handler);
  const transcriptions=new TranscriptionTasks(join(local,'smartsub'),smartsubInvoke,id=>smartsubTasks.downloadReceipt(id),id=>smartsubTasks.cacheDirectory(id),(id,operation,input)=>smartsubTasks.invokeFor(id,operation,input),()=>smartsubPreferences.selection());
  const smartsubTaskHandlers=createSmartSubTaskHandlers({isTrustedSender:trusted,
    readiness:()=>inspectSmartSub(smartsubInvoke),
    prepare:async url=>({requestId:(await smartsubTasks.prepare(url)).requestId}),submit:async(id,url)=>{const ready=await inspectSmartSub(smartsubInvoke);if(!ready.compatible)throw new Error('当前 SmartSub 版本缺少所需任务接口。');if(!ready.downloaders.length)throw new Error('缺少视频下载组件，请在 SmartSub 中安装后重试。');return smartsubTasks.submit(id,url);},
    refresh:id=>smartsubTasks.refresh(id),cancel:id=>smartsubTasks.cancel(id),
    importSubtitle:async(id,index)=>{const snapshot=await smartsubTasks.subtitle(id,index),entry=await workspace.registerSource(snapshot.document.originalPath);return {document:remember(snapshot),entryId:entry.id};},
    transcriptionReady:id=>transcriptions.preview(id),transcribe:(id,engine,model)=>transcriptions.submit(id,engine,model),transcriptionRetry:(id,engine,model)=>transcriptions.retry(id,engine,model),transcriptionRefresh:id=>transcriptions.refresh(id),transcriptionCancel:id=>transcriptions.cancel(id),
    transcriptionImport:async(id,index)=>{const snapshot=await transcriptions.subtitle(id,index),entry=await workspace.registerSource(snapshot.document.originalPath);return {document:remember(snapshot),entryId:entry.id};},
  });
  for(const [action,handler] of Object.entries(smartsubTaskHandlers))ipcMain.handle(`smartsub-task:${action}`,handler);
  const results=new NoteResults(join(local,'note-results'),workspace);
  const subscriptionTask=createSubscriptionTask({trusted,session:()=>subscription.getSession(),models:()=>subscription.listModels(),preview:(id,folder)=>workspace.previewOutput(id,folder),analyze:async(id,plan,profile,model,instructions,signal)=>{const release=workspace.lockPaths([plan.sourcePath,plan.notePath]);try{const source:SourceSnapshot=await tasks.run(join(__dirname,'source-worker.cjs'),{filePath:await workspace.filePath('source',id)});if(plan.sourceChecksum && source.document.checksum!==plan.sourceChecksum)throw new WorkspaceError('CONFLICT');return (await analyzeSubscription(source.document,subscription,profile,model,{signal,instructions})).markdown;}finally{release();}},stage:(plan,markdown)=>results.add(plan,markdown)});
  for(const [action,handler] of Object.entries(subscriptionTask))ipcMain.handle(`subscription-task:${action}`,action==='start'?(event,...args)=>guarded(event,'subscription',()=>handler(event,...args)):handler);
  const exporter=new ArchiveExporter(workspace,()=>new StorageService(join(local,'storage')).state());
  const stopWatching=workspace.subscribe(change=>{if(!window.isDestroyed())window.webContents.send('workspace:changed',change);});
  const workspaceHandler = createWorkspaceHandler({ isTrustedSender: trusted, execute: async (kind, action, args) => {
    const type = kind as 'source' | 'notes'; const id = args[0] as string;
    if (action === 'root') return workspace.root(type);
    if (action === 'choose') { const selected = await dialog.showOpenDialog(window, { title: type === 'source' ? '选择资料根目录' : '选择笔记根目录', properties: ['openDirectory', 'createDirectory'] }); return selected.canceled || !selected.filePaths[0] ? undefined : workspace.choose(type, selected.filePaths[0]); }
    if (action === 'list') return workspace.list(type, id, args[1] as number | undefined);
    if (action === 'search') return workspace.search(type, args[0] as string);
    if (action === 'mkdir') return workspace.createDirectory(type, id, args[1] as string);
    if (action === 'create') return workspace.createNote(id, args[1] as string);
    if (action === 'move') return workspace.move(type, id, args[1] as string);
    if (action === 'moveMany') return workspace.moveMany(type,args[0] as string[],args[1] as string);
    if (action === 'rename') return workspace.rename(type, id, args[1] as string);
    if (action === 'trash') return workspace.trash(type, id, path => shell.trashItem(path));
    if (action === 'trashMany') return workspace.trashMany(type,args[0] as string[],path=>shell.trashItem(path));
    if (action === 'entry') return workspace.entry(type,id);
    if (action === 'read') return workspace.readNote(id);
    if (action === 'save') return workspace.saveNote(id, args[1] as string, args[2] as string);
    if (action === 'associate') return workspace.associate(id, args[1] as string);
    if (action === 'import') return loadInWorker(await workspace.filePath(type, id));
    throw new Error('Invalid workspace action');
  } });
  let workspaceQueue:Promise<unknown>=Promise.resolve();
  const queuedWorkspace=(event:unknown,kind:unknown,action:unknown,args:unknown[])=>{const operation=workspaceQueue.then(()=>workspaceHandler(event,kind,action,...args));workspaceQueue=operation.catch(()=>{});return operation;};
  ipcMain.handle('workspace:action', async (event, kind, action, ...args) => {
    if (!trusted(event)) return workspaceHandler(event, kind, action, ...args);
    if (!['choose','mkdir','create','move','moveMany','rename','trash','trashMany','save','associate'].includes(action)) return queuedWorkspace(event,kind,action,args);
    if (gateBusy) return { status: 'error', error: { code: 'BUSY', message: '整理任务进行中，请稍后操作文件。' } };
    gateBusy = true;
    try {
      if ((activeJob==='single' || activeJob==='subscription') && await isJobActive(event)) return { status: 'error', error: { code: 'BUSY', message: '整理任务进行中，请稍后操作文件。' } };
      return await queuedWorkspace(event,kind,action,args);
    } finally { gateBusy = false; }
  });
  const workflowHandlers = createWorkflowHandlers({ isTrustedSender: trusted, source: id => snapshots.get(id), credentials: () => apiStore.credentials(),
    hasDirectory: async () => Boolean((await tasks.run(join(__dirname, 'storage-worker.cjs'), { stateDir: join(local, 'storage'), action: 'state', payload: {} }, true)).directory),
    analyze: (source, credentials, options) => runAnalysisWorker(join(__dirname, 'analysis-worker.cjs'), source, credentials, options),
    save: (source, result) => tasks.run(join(__dirname, 'storage-worker.cjs'), { stateDir: join(local, 'storage'), action: 'save-generated', payload: { snapshot: source, markdown: result.markdown, metadata: { kind: 'generated-note', provider: result.attempt.provider, model: result.attempt.model, promptVersion: result.attempt.promptVersion, sourceRefs: result.sourceRefs } } }, true),
    resume: draftId => tasks.run(join(__dirname, 'storage-worker.cjs'), { stateDir: join(local, 'storage'), action: 'resume', payload: { draftId } }, true),
  });
  const batchReuse=new BatchReuse();
  const batchHandlers = createBatchHandlers({ isTrustedSender: trusted,resetAnalysis:()=>batchReuse.clear(),
    config: async () => { const value = await apiStore.state(); if (!value.configured) throw new ApiError('INVALID_CONFIG'); return value; },
    preview: (id, target) => workspace.previewOutput(id, target),
    analyze: async (id, expected, signal,plan,report) => { const credentials = await apiStore.credentials(); if (credentials.baseUrl !== expected.baseUrl || credentials.model !== expected.model) throw new ApiError('INVALID_CONFIG');
      const started=performance.now();
      const source:SourceSnapshot = await tasks.run(join(__dirname, 'source-worker.cjs'), { filePath: await workspace.filePath('source', id) });
      if(plan.sourceChecksum && source.document.checksum!==plan.sourceChecksum)throw new WorkspaceError('CONFLICT');
      const prepareMs=performance.now()-started;let metrics:AnalysisMetrics={prepareMs:0,apiMs:0,localMs:0,requests:0};
      const value=await batchReuse.run(source.document,credentials,expected.instructions??'',signal,async(checkpoints)=>{
        const result=await runAnalysisWorker(join(__dirname, 'analysis-worker.cjs'), source.document, credentials, { signal, checkpoints, instructions: expected.instructions,onProgress:value=>report(value),onMetrics:value=>{metrics=value;report(undefined,{...metrics,prepareMs:prepareMs+metrics.prepareMs,saveMs:0});} });return result.markdown;
      });return {...value,timing:{...metrics,prepareMs:prepareMs+metrics.prepareMs,saveMs:0}}; },
    save: (id, target, plan, markdown) => workspace.writeOutput(id, target, plan, markdown),
    lock:plans=>workspace.lockPaths(plans.flatMap(plan=>[plan.sourcePath,plan.notePath])),
    stage:(plan,markdown)=>results.add(plan,markdown),complete:id=>results.remove(id),
  });
  const fileAction=async(event:unknown,run:()=>Promise<unknown>)=>{
    if(!trusted(event) || gateBusy)return {status:'error',error:{code:'BUSY',message:'操作未完成，请稍后重试。'}};
    gateBusy=true;try{return {status:'ok',value:await run()};}catch(error){const code=error instanceof WorkspaceError?error.code:(error as NodeJS.ErrnoException).code;
      return {status:'error',error:{code:code??'FAILED',message:code==='CONFLICT' || code==='EEXIST'?'文件已存在或已被修改，请更改名称、位置或重新确认。':code==='BUSY'?'此文件正用于整理任务，请稍后操作。':code==='MISSING' || code==='ENOENT'?'原位置不可用，请重新选择位置。':'操作未完成，请检查文件、目录和权限。'}};
    }finally{gateBusy=false;}
  };
  ipcMain.handle('results:list',(event,...args)=>fileAction(event,async()=>{if(args.length)throw new WorkspaceError('INVALID_REQUEST');return results.list();}));
  ipcMain.handle('results:prepare',(event,...args)=>fileAction(event,async()=>{const [id,folder,name]=args;if(args.length<1 || args.length>3 || !isUuid(id) || (folder!==undefined && !isUuid(folder)) || (name!==undefined && (typeof name!=='string' || name.length>200)))throw new WorkspaceError('INVALID_REQUEST');return results.prepare(id,folder,name);}));
  ipcMain.handle('results:save',(event,...args)=>fileAction(event,async()=>{if(args.length!==1 || !isUuid(args[0]))throw new WorkspaceError('INVALID_REQUEST');const saved=await results.save(args[0]);await batchHandlers.saved(event,saved.id,saved.path);return null;}));
  ipcMain.handle('archive:preview',(event,...args)=>fileAction(event,async()=>{if(args.length!==1 || !isUuid(args[0]))throw new WorkspaceError('INVALID_REQUEST');return exporter.preview(args[0]);}));
  ipcMain.handle('archive:export',(event,...args)=>fileAction(event,async()=>{const [folder,selected]=args;if(args.length!==2 || !isUuid(folder) || !Array.isArray(selected) || !selected.length || selected.length>1000 || selected.some(item=>!item || !isUuid(item.id) || typeof item.name!=='string' || item.name.length>200))throw new WorkspaceError('INVALID_REQUEST');return exporter.export(folder,selected);}));
  async function isJobActive(event: unknown): Promise<boolean> {
    if (!activeJob) return false; const response = activeJob === 'single' ? await workflowHandlers.state(event) : activeJob === 'subscription' ? await subscriptionTask.state(event) : await batchHandlers.state(event);
    if (response.status === 'ok' && ['running','saving'].includes(response.value.status)) return true;
    activeJob = undefined; return false;
  }
  const guarded = async (event: unknown, type: 'single' | 'batch' | 'subscription', run: () => Promise<any>) => {
    if (!trusted(event) || gateBusy) return { status: 'error', error: { code: 'BUSY', message: '已有整理任务正在进行。' } };
    gateBusy = true; try { if (await isJobActive(event)) return { status: 'error', error: { code: 'BUSY', message: '已有整理任务正在进行。' } };
      activeJob = type; const result = await run(); if (result.status !== 'ok' || !['running','saving'].includes(result.value.status)) activeJob = undefined; return result;
    } finally { gateBusy = false; }
  };
  for (const [action, handler] of Object.entries(workflowHandlers)) ipcMain.handle(`workflow:${action}`, action === 'start' || action === 'retry' ? (event, ...args) => guarded(event, 'single', () => handler(event, ...args)) : handler);
  for (const [action, handler] of Object.entries(batchHandlers).filter(([action])=>action!=='saved')) ipcMain.handle(`batch:${action}`, action === 'start' || action === 'retry' ? (event, ...args) => guarded(event, 'batch', () => handler(event, ...args)) : handler);
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
  window.on('close', () => { void subscriptionTask.cancel({sender:window.webContents,senderFrame:window.webContents.mainFrame}); });
  window.on('closed', () => {
    subscription.cancelSignIn();
    for(const action of Object.keys(subscriptionTask))ipcMain.removeHandler(`subscription-task:${action}`);
    for (const action of Object.keys(subscriptionHandlers)) ipcMain.removeHandler(`subscription:${action}`);
    for(const action of ['state','save'])ipcMain.removeHandler(`smartsub-preferences:${action}`);
    for(const action of ['state','choose','openOfficial'])ipcMain.removeHandler(`smartsub:${action}`);
    for(const action of Object.keys(smartsubTaskHandlers))ipcMain.removeHandler(`smartsub-task:${action}`);
    stopWatching();
    for(const channel of ['results:list','results:prepare','results:save','archive:preview','archive:export'])ipcMain.removeHandler(channel);
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
