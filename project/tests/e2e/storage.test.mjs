import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {StorageService} from '../../src/modules/storage/service.ts';
import {parseSource} from '../../src/modules/source/parser.ts';

test('legacy archive capabilities remain compatible across restart without returning to the daily UI',{timeout:120000},async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,'storage-ui-')),profile=join(own,'profile'),output=join(own,'旧归档');mkdirSync(output);const input=join(own,'来源 UTF16.txt'),raw=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('原文必须完整保留\r\n\r\n第二段','utf16le')]);writeFileSync(input,raw);
  let app,page,sourceId,first;const start=async()=>{const env={...process.env,CLIPNOTE_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});page=await app.firstWindow();page.setDefaultTimeout(8000);await page.getByRole('button',{name:'打开文件',exact:true}).waitFor();};const stop=async()=>{if(app){await app.close();app=undefined;}};
  const picker=path=>app.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>selected?{canceled:false,filePaths:[selected]}:{canceled:true,filePaths:[]};},path);
  const call=(method,...args)=>page.evaluate(([method,args])=>window.clipnote[method](...args),[method,args]);const state=async()=>{const result=await call('libraryState');assert.equal(result.status,'ok');return result.value;};t.after(async()=>{await stop();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});await start();
  await t.test('explicit legacy calls preserve imported bytes and cancelled selection creates no output',async()=>{
    assert.equal(await page.getByRole('button',{name:'选择保存目录',exact:true}).count(),0);await picker(undefined);assert.equal((await call('chooseLibrary')).status,'cancelled');assert.equal((await state()).directory,null);
    await picker(input);const imported=await call('importSource');assert.equal(imported.status,'imported');sourceId=imported.document.sourceId;writeFileSync(input,'导入后修改');await picker(output);assert.equal((await call('chooseLibrary')).status,'ok');const saved=await call('saveSource',sourceId);assert.equal(saved.status,'ok');first=saved.value;assert.deepEqual(readFileSync(first.sourcePath),raw);
  });
  await t.test('another legacy save preserves an externally edited older version',async()=>{writeFileSync(first.notePath,'人工编辑，不能覆盖');assert.equal((await call('saveSource',sourceId)).status,'ok');assert.equal((await state()).revisions.length,2);assert.equal(readFileSync(first.notePath,'utf8'),'人工编辑，不能覆盖');});
  await t.test('restarted legacy reading can restore archived source after the original is removed',async()=>{await stop();rmSync(input);await start();const opened=await call('openRevision',first.sourceId,first.revisionId);assert.equal(opened.status,'ok');assert.equal(opened.value.document.rawText,'原文必须完整保留\r\n\r\n第二段');});
  await t.test('legacy recovery drafts remain recoverable into another explicitly selected archive',async()=>{await stop();const failing=new StorageService(join(profile,'storage'),{checkpoint:stage=>{if(stage==='after-source')throw Object.assign(new Error('synthetic full disk'),{code:'ENOSPC'});}});await assert.rejects(failing.save({document:parseSource(raw,input),bytes:raw},'# 恢复正文',{kind:'generated-note'}));await start();const before=await state();assert.equal(before.drafts.length,1);const other=join(own,'恢复位置');mkdirSync(other);await picker(other);assert.equal((await call('chooseLibrary')).status,'ok');assert.equal((await call('resumeSave',before.drafts[0].draftId)).status,'ok');assert.equal((await state()).drafts.length,0);assert.equal(readFileSync(first.notePath,'utf8'),'人工编辑，不能覆盖');});
  await t.test('renderer cannot supply output paths or escape through legacy revision IDs',async()=>{for(const [method,args] of [['chooseLibrary',['D:/private']],['saveSource',['../private']],['openRevision',['a'.repeat(64),'../note']]])assert.equal((await call(method,...args)).status,'error');});
  await t.test('legacy archive transport failures are visible without unhandled renderer errors',async()=>{const errors=[];page.on('pageerror',error=>errors.push(error.message));await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('storage:state');ipcMain.handle('storage:state',()=>{throw new Error('synthetic archive transport failure');});});await page.getByRole('button',{name:'旧归档',exact:true}).click();await page.getByRole('dialog',{name:'旧归档',exact:true}).getByRole('status').waitFor();assert.deepEqual(errors,[]);});
});
