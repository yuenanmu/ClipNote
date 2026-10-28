import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';

test('batch confirms, processes selected sources serially and protects edited notes', {timeout:120000}, async t => {
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url)); mkdirSync(base,{recursive:true}); const own=mkdtempSync(join(base,'batch-ui-'));
  const sources=join(own,'资料'), notes=join(own,'笔记'); mkdirSync(sources); mkdirSync(notes); writeFileSync(join(sources,'a.txt'),'失败资料'); writeFileSync(join(sources,'b.txt'),'成功资料');
  let calls=0, failing=true, active=0, max=0;
  const server=createServer(async(req,res)=>{ active++; max=Math.max(active,max); calls++; const chunks=[]; for await(const part of req) chunks.push(part); const body=JSON.parse(Buffer.concat(chunks).toString());
    const data=JSON.parse(body.messages.at(-1).content.split('\n')[1]); const refs=data.core.map(({segmentId,startOffset,endOffset})=>({segmentId,startOffset,endOffset}));
    if(failing && data.core.some(ref=>ref.text.includes('失败资料'))) { active--; res.writeHead(503); res.end(); return; }
    await new Promise(resolve=>setTimeout(resolve,120)); const text=JSON.stringify({title:'合成笔记',sections:[{heading:'章节',refs,items:[{kind:'point',text:'合成结果',refs,children:[]}]}]});
    res.writeHead(200,{'Content-Type':'text/event-stream'}); res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})}\n\n`);
    res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\n`); active--; res.end('data: [DONE]\n\n'); });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile')}; delete env.ELECTRON_RUN_AS_NODE; let app;
  t.after(async()=>{ if(app) await app.close(); await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}); assert.equal(resolve(dirname(own)),resolve(base)); rmSync(own,{recursive:true,force:true}); });
  app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env}); const page=await app.firstWindow(); page.setDefaultTimeout(15000);
  const config=await page.evaluate(input=>window.clipnote.apiSave(input),{baseUrl,model:'fixture',contextWindow:8192,maxTokens:2048,apiKey:'synthetic-key'}); assert.equal(config.status,'ok');
  const pick=path=>app.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});},path);
  await pick(sources); const tree=page.getByRole('region',{name:'资料文件夹'}); await tree.getByRole('button',{name:'选择',exact:true}).click(); await tree.getByLabel('选择 a.txt').check(); await tree.getByLabel('选择 b.txt').check();
  const panel=page.getByRole('region',{name:'批量整理'}); await panel.getByRole('button',{name:'批量整理（2）'}).click(); await pick(notes); await panel.getByRole('button',{name:'选择笔记根目录'}).click(); await panel.getByRole('button',{name:'检查所选文件'}).click();
  assert.equal(calls,0); await panel.getByText('确认批量发送').waitFor(); await page.screenshot({path:join(base,'batch-confirm.png')}); await panel.getByRole('button',{name:'确认发送并开始'}).click(); await panel.getByText(/a\.txt · 失败/).waitFor(); await panel.getByText(/b\.txt · 完成/).waitFor();
  assert.equal(max,1); assert.equal(calls,2); assert.match(readFileSync(join(notes,'b.md'),'utf8'),/合成结果/); assert.equal(readFileSync(join(sources,'a.txt'),'utf8'),'失败资料');
  failing=false; await panel.getByLabel('重试 a.txt').check(); await panel.getByRole('button',{name:'重试选中失败项'}).click(); await panel.getByText(/a\.txt · 完成/).waitFor(); assert.equal(calls,3);
  await panel.getByRole('button',{name:'检查所选文件'}).click(); await panel.getByText('确认批量发送').waitFor(); assert.equal(await panel.getByText(/将覆盖已关联笔记/).count(),2);
  await panel.getByRole('button',{name:'确认发送并开始'}).click(); for(let i=0;i<100 && calls<4;i++) await page.waitForTimeout(20); assert.ok(calls>=4); writeFileSync(join(notes,'b.md'),'人工编辑的内容');
  await panel.getByText(/b\.txt · 失败/).waitFor(); assert.equal(readFileSync(join(notes,'b.md'),'utf8'),'人工编辑的内容');
});
