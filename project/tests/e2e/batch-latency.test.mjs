import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';

test('duplicate files reuse one request with live progress, independent saves and actionable failures',{timeout:120000},async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));mkdirSync(base,{recursive:true});
  const own=mkdtempSync(join(base,'batch-latency-')),sources=join(own,'sources'),notes=join(own,'notes');mkdirSync(sources);mkdirSync(notes);
  const names=['a.txt','b.txt','c.txt','d.txt'];for(const name of names)writeFileSync(join(sources,name),name==='d.txt'?'different':'same 😀 content');
  let calls=0,failing=true;
  const server=createServer(async(req,res)=>{
    calls++;const bytes=[];for await(const part of req)bytes.push(part);
    const payload=JSON.parse(JSON.parse(Buffer.concat(bytes).toString()).messages.at(-1).content.split('\n')[1]);
    if(failing && payload.core.some(ref=>ref.text==='different')){res.writeHead(503);res.end();return;}
    await new Promise(resolve=>setTimeout(resolve,1100));
    if(res.destroyed)return;
    const refs=payload.core.map(ref=>ref.refId);
    const text=JSON.stringify({title:'合成笔记',sections:[{heading:'章节',refs,items:[{kind:'point',text:'测试内容',refs,children:[]}]}]});
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const frame=(content,finish)=>`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{content},finish_reason:finish}]})}\n\n`;
    res.write(frame(text,null));await new Promise(resolve=>setTimeout(resolve,900));
    if(!res.destroyed)res.end(frame('','stop')+'data: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile')};delete env.ELECTRON_RUN_AS_NODE;
  let app;
  t.after(async()=>{if(app)await app.close();await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});
  app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});const page=await app.firstWindow();page.setDefaultTimeout(15000);
  assert.equal((await page.evaluate(input=>window.clipnote.apiSave(input),{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',apiKey:'synthetic',contextWindow:8192,maxTokens:2048})).status,'ok');
  const pick=path=>app.evaluate(({dialog},value)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[value]});},path);
  await pick(sources);await page.getByRole('button',{name:'打开资料文件夹',exact:true}).click();
  const tree=page.getByRole('tree',{name:'资料文件树'});
  for(const [index,name] of names.entries())await tree.getByRole('treeitem',{name,exact:true}).click(index?{modifiers:['Control']}:{});
  const panel=page.getByRole('region',{name:'批量整理'});await panel.getByRole('button',{name:'批量整理（4）'}).click();await panel.getByRole('button',{name:'选择笔记文件夹'}).click();await pick(notes);
  const picker=page.getByRole('dialog',{name:'选择笔记保存位置'});await picker.getByRole('button',{name:'打开笔记文件夹'}).click();await picker.getByRole('button',{name:'使用此文件夹'}).click();
  await panel.getByRole('button',{name:'检查所选文件'}).click();await panel.getByRole('button',{name:'确认发送并开始'}).click();
  await panel.getByText(/等待服务响应 ·/).waitFor();await page.screenshot({path:join(base,'batch-latency-waiting.png')});
  await panel.getByText(/正在接收响应 ·/).waitFor();
  await panel.locator('.batch-item.failed').filter({hasText:'d.txt'}).waitFor();
  assert.equal(calls,2);assert.equal(await panel.getByText('复用本批相同内容，未重复请求 AI。',{exact:true}).count(),2);
  for(const name of ['a','b','c'])assert.match(readFileSync(join(notes,name+'.md'),'utf8'),/测试内容/);
  const state=await page.evaluate(()=>window.clipnote.batchState());
  assert.equal(state.value.items[1].timing.requests,0);assert.equal(state.value.items[2].timing.apiMs,0);
  assert.equal(state.value.items[3].timing.requests,1);assert.ok(state.value.items[3].finishedAt);
  await panel.locator('.batch-item.failed').scrollIntoViewIfNeeded();
  await page.screenshot({path:join(base,'batch-latency-results.png')});
  failing=false;await panel.getByLabel('重试 d.txt').check();await panel.getByRole('button',{name:'重试选中失败项'}).click();
  await panel.locator('.batch-item.succeeded').filter({hasText:'d.txt'}).waitFor();assert.equal(calls,3);
  // A new batch must issue fresh requests. An externally changed duplicate must not reuse old content.
  await panel.getByRole('button',{name:'检查所选文件'}).click();await panel.getByRole('button',{name:'确认发送并开始'}).click();
  await panel.getByText(/等待服务响应 ·/).first().waitFor();writeFileSync(join(sources,'c.txt'),'external change');
  await panel.locator('.batch-item.failed').filter({hasText:'c.txt'}).waitFor();
  await page.waitForFunction(async()=> (await window.clipnote.batchState()).value.status==='done');
  assert.equal(calls,5);assert.match(readFileSync(join(notes,'c.md'),'utf8'),/测试内容/);
});
