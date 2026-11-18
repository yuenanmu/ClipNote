import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';

test('first-output timeout after heartbeats does not save a note',{timeout:160000},async t=>{
 const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));mkdirSync(base,{recursive:true});
 const own=mkdtempSync(join(base,'first-output-timeout-')),sources=join(own,'sources'),notes=join(own,'notes');mkdirSync(sources);mkdirSync(notes);writeFileSync(join(sources,'source.txt'),'synthetic source');
 let requests=0;
 const server=createServer(async(req,res)=>{
  requests++;for await(const _ of req){}
  res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': heartbeat\n\n');
  const timer=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},5000);
  res.on('close',()=>clearInterval(timer));
  await new Promise(resolve=>setTimeout(resolve,122000));clearInterval(timer);
  if(!res.destroyed)res.end('data: [DONE]\n\n');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let app;const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 t.after(async()=>{if(app)await app.close();await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});
 app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});
 const page=await app.firstWindow();page.setDefaultTimeout(135000);
 assert.equal((await page.evaluate(input=>window.clipnote.apiSave(input),{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',apiKey:'synthetic',contextWindow:8192,maxTokens:2048})).status,'ok');
 const pick=path=>app.evaluate(({dialog},value)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[value]});},path);
 await pick(sources);await page.getByRole('button',{name:'打开资料文件夹',exact:true}).click();await page.getByRole('treeitem',{name:'source.txt',exact:true}).click();
 const panel=page.getByRole('region',{name:'批量整理'});await panel.getByRole('button',{name:'批量整理（1）'}).click();await panel.getByRole('button',{name:'选择笔记文件夹'}).click();await pick(notes);
 const picker=page.getByRole('dialog',{name:'选择笔记保存位置'});await picker.getByRole('button',{name:'打开笔记文件夹'}).click();await picker.getByRole('button',{name:'使用此文件夹'}).click();
 await panel.getByRole('button',{name:'检查所选文件'}).click();await panel.getByRole('button',{name:'确认发送并开始'}).click();
 await panel.getByLabel('整理阶段').getByText(/等待首个有效输出超时/).waitFor();
 await page.waitForTimeout(3000);
 assert.equal(existsSync(join(notes,'source.md')),false);assert.equal(requests,1);
 const records=await page.evaluate(()=>window.clipnote.organizationList());const failed=records.value.find(item=>item.status==='failed');
 assert.equal(failed.error,'first_output_timeout');assert.equal(failed.events.filter(event=>['failed','succeeded','cancelled'].includes(event.phase)).length,1);assert.ok(!failed.events.some(event=>event.phase==='first_text'||event.phase==='saving'));
});
