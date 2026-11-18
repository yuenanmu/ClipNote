import {electronTestTarget} from './electron-target.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {createServer} from 'node:http';

test('subscription diagnostics follow the real desktop task through saving',{timeout:120000},async t=>{
 const target=electronTestTarget(),base=target.artifacts;mkdirSync(base,{recursive:true});
 const own=mkdtempSync(join(base,'subscription-diagnostic-')),sources=join(own,'sources'),notes=join(own,'notes');mkdirSync(sources);mkdirSync(notes);writeFileSync(join(sources,'sample.txt'),'合成资料');
 const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile')};delete env.ELECTRON_RUN_AS_NODE;let app;
 const launch=()=>electron.launch({executablePath:target.executablePath,args:target.args,env});
 t.after(async()=>{if(app)await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});
 const account={version:2,activeProfileId:'fixture',pendingRegistrations:[],profiles:[{version:1,id:'fixture',label:'Synthetic',clientId:'fixture-client',status:'connected',scopes:['chatgpt.tokens.use.direct'],savedAt:new Date().toISOString(),identity:{email:'test@example.test'},credentials:{accessToken:'synthetic-restart-secret',expiresAt:Date.now()+3600000}}]};
 app=await launch();const ciphertext=await app.evaluate(({safeStorage},data)=>safeStorage.encryptString(JSON.stringify(data)).toString('base64'),account);await app.close();app=undefined;
 const path=join(own,'profile','subscription');mkdirSync(path,{recursive:true});writeFileSync(join(path,'chatgpt-auth.json'),JSON.stringify({version:3,provider:'electron-safe-storage-v1',ciphertext}));
 app=await launch();const page=await app.firstWindow();page.setDefaultTimeout(process.env.CLIPNOTE_TEST_LONG_STREAM==='1'?90000:10000);
 await app.evaluate(({session},longStream)=>session.fromPartition('clipnote-subscription').protocol.handle('https',async request=>{
   const url=new URL(request.url);
   if(url.hostname!=='api.openai.com')return new Response('',{status:403});
   if(url.pathname==='/v1/models')return Response.json({models:[{slug:'fixture',display_name:'Fixture',visibility:'list'}]});
   if(url.pathname!=='/v1/responses')return new Response('',{status:404});
   const body=await request.json();const prompt=body.input[0].content;const payload=JSON.parse(prompt.slice(prompt.indexOf('\n')+1).replace(/\n请仅输出完整 JSON。$/,''));
   const {segmentId,startOffset,endOffset}=payload.core[0],ref={segmentId,startOffset,endOffset};
   const text=JSON.stringify({title:'合成笔记',sections:[{heading:'主题',refs:[ref],items:[{kind:'point',text:'合成要点',refs:[ref],children:[]}]}]});
   const event=value=>'data: '+JSON.stringify(value)+'\n\n';
   if(longStream){
     const parts=[text.slice(0,8),text.slice(8,16),text.slice(16,24),text.slice(24)];
     const encoder=new TextEncoder();
     return new Response(new ReadableStream({async start(controller){for(const [index,part] of parts.entries()){if(index)await new Promise(resolve=>setTimeout(resolve,20500));controller.enqueue(encoder.encode(event({type:'response.output_text.delta',delta:part})));}controller.enqueue(encoder.encode(event({type:'response.completed',response:{status:'completed'}})));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
   }
   return new Response(event({type:'response.output_text.delta',delta:' '})+event({type:'response.output_text.delta',delta:text})+event({type:'response.completed',response:{status:'completed'}}),{headers:{'Content-Type':'text/event-stream'}});
 }),process.env.CLIPNOTE_TEST_LONG_STREAM==='1');
 const pick=selected=>app.evaluate(({dialog},value)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[value]});},selected);
 await pick(sources);await page.getByRole('button',{name:'打开资料文件夹',exact:true}).click();await page.getByRole('treeitem',{name:'sample.txt',exact:true}).click();
 const panel=page.getByRole('region',{name:'批量整理'});await panel.getByRole('button',{name:'批量整理（1）'}).click();await panel.getByRole('button',{name:'选择笔记文件夹'}).click();await pick(notes);
 const picker=page.getByRole('dialog',{name:'选择笔记保存位置'});await picker.getByRole('button',{name:'打开笔记文件夹'}).click();await picker.getByRole('button',{name:'使用此文件夹'}).click();await panel.getByLabel('整理服务').selectOption('subscription');
 await panel.getByRole('button',{name:'检查资料'}).click();await panel.getByRole('button',{name:'确认发送'}).click();
 await panel.getByRole('region',{name:'待保存结果'}).getByRole('button',{name:'恢复保存'}).waitFor();
 await panel.getByLabel('整理阶段').getByText(/等待确认保存/).waitFor();
 let data=await page.evaluate(()=>window.clipnote.organizationList());let item=data.value.find(record=>record.service==='subscription');assert.equal(item.status,'awaiting_save');
 for(const phase of ['request','headers','first_text','received','validating','staging','awaiting_save'])assert.ok(item.events.some(event=>event.phase===phase),phase);
 await panel.getByRole('region',{name:'待保存结果'}).getByRole('button',{name:'恢复保存'}).click();await page.getByRole('dialog',{name:'恢复保存结果'}).getByRole('button',{name:'确认保存结果'}).click();
 await page.getByText('结果已保存。').waitFor();data=await page.evaluate(()=>window.clipnote.organizationList());item=data.value.find(record=>record.id===item.id);assert.equal(item.status,'succeeded');assert.ok(item.events.some(event=>event.phase==='saved'));assert.doesNotMatch(JSON.stringify(item),/合成资料|合成要点|synthetic-restart-secret/);
 await panel.getByLabel('整理阶段').getByText(/已完成/).waitFor();
 assert.equal(await panel.getByText('整理完成，请在待保存结果中确认保存。').count(),0);
 await app.evaluate(async({session})=>{const protocol=session.fromPartition('clipnote-subscription').protocol;protocol.unhandle('https');protocol.handle('https',async request=>{const url=new URL(request.url);if(url.hostname!=='api.openai.com')return new Response('',{status:403});if(url.pathname==='/v1/models')return Response.json({models:[{slug:'fixture',display_name:'Fixture',visibility:'list'}]});return Response.json({error:{message:'private remote error'}},{status:503});});});
 await panel.getByRole('button',{name:'检查资料'}).click();await panel.getByRole('button',{name:'确认发送'}).click();
 let failed;for(let i=0;i<100 && !failed;i++){data=await page.evaluate(()=>window.clipnote.organizationList());failed=data.value.find(record=>record.service==='subscription'&&record.status==='failed');if(!failed)await new Promise(resolve=>setTimeout(resolve,100));}
 assert.ok(failed,'failed task was not recorded');
 assert.equal(failed.error,'network');assert.ok(failed.events.some(event=>event.phase==='request'));assert.doesNotMatch(JSON.stringify(failed),/private remote error|synthetic-restart-secret/);
 await app.evaluate(async({session})=>{const protocol=session.fromPartition('clipnote-subscription').protocol;protocol.unhandle('https');protocol.handle('https',async request=>{const url=new URL(request.url);if(url.hostname!=='api.openai.com')return new Response('',{status:403});if(url.pathname==='/v1/models')return Response.json({models:[{slug:'fixture',display_name:'Fixture',visibility:'list'}]});return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'partial private'})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});});});
 await panel.getByRole('button',{name:'检查资料'}).click();await panel.getByRole('button',{name:'确认发送'}).click();
 let interrupted;for(let i=0;i<100 && !interrupted;i++){data=await page.evaluate(()=>window.clipnote.organizationList());interrupted=data.value.find(record=>record.service==='subscription'&&record.status==='failed'&&record.id!==failed.id);if(!interrupted)await new Promise(resolve=>setTimeout(resolve,100));}
 assert.ok(interrupted,'interrupted task was not recorded');
 await panel.getByLabel('整理阶段').getByText(/失败 · 上一阶段：正在接收正文/).waitFor();
 const interruptedPhases=interrupted.events.map(event=>event.phase);
 for(const phase of ['headers','first_text','last_text','failed'])assert.ok(interruptedPhases.includes(phase),phase);
 assert.equal(interruptedPhases.filter(phase=>['succeeded','failed','cancelled'].includes(phase)).length,1);
 assert.ok(!interruptedPhases.includes('received'));assert.ok(!interruptedPhases.includes('saving'));
 assert.ok(interrupted.events.every(event=>Number.isFinite(event.elapsedMs)&&event.elapsedMs>=0));
 assert.doesNotMatch(JSON.stringify(interrupted),/partial private|synthetic-restart-secret/);
 await app.evaluate(async({session})=>{const protocol=session.fromPartition('clipnote-subscription').protocol;protocol.unhandle('https');protocol.handle('https',async request=>{const url=new URL(request.url);if(url.hostname!=='api.openai.com')return new Response('',{status:403});if(url.pathname==='/v1/models')return Response.json({models:[{slug:'fixture',display_name:'Fixture',visibility:'list'}]});const encoder=new TextEncoder();return new Response(new ReadableStream({start(controller){controller.enqueue(encoder.encode('data: '+JSON.stringify({type:'response.output_text.delta',delta:'partial private'})+'\n\n'));},cancel(){}}),{headers:{'Content-Type':'text/event-stream'}});});});
 await panel.getByRole('button',{name:'检查资料'}).click();await panel.getByRole('button',{name:'确认发送'}).click();
 await panel.getByRole('button',{name:'停止',exact:true}).click();
 let cancelled;for(let i=0;i<100 && !cancelled;i++){data=await page.evaluate(()=>window.clipnote.organizationList());cancelled=data.value.find(record=>record.service==='subscription'&&record.status==='cancelled');if(!cancelled)await new Promise(resolve=>setTimeout(resolve,100));}
 assert.ok(cancelled,'cancelled task was not recorded');assert.equal(cancelled.events.filter(event=>['succeeded','failed','cancelled'].includes(event.phase)).length,1);assert.doesNotMatch(JSON.stringify(cancelled),/partial private|synthetic-restart-secret/);
 await page.waitForTimeout(600);
 assert.match(readFileSync(join(notes,'sample.md'),'utf8'),/合成要点/);
 assert.equal((await page.evaluate(()=>window.clipnote.savedResults())).value.length,0);
});

test('subscription settings and file confirmation use safe synthetic services',{timeout:60000},async t=>{
 const target=electronTestTarget(),base=target.artifacts;mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,'subscription-ui-')),sources=join(own,'sources'),notes=join(own,'notes');mkdirSync(sources);mkdirSync(notes);writeFileSync(join(sources,'sample.txt'),'合成内容');
 const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile')};delete env.ELECTRON_RUN_AS_NODE;const app=await electron.launch({executablePath:target.executablePath,args:target.args,env});t.after(async()=>{await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});const page=await app.firstWindow();page.setDefaultTimeout(10000);
 await app.evaluate(({ipcMain})=>{let task={status:'idle'},sent=0,connected=true;const set=(name,fn)=>{ipcMain.removeHandler(name);ipcMain.handle(name,fn);};set('subscription:state',()=>({status:'ok',value:connected?{status:'connected',sharing:true,profileId:'test',identity:{email:'test@example.test'}}:{status:'disconnected',sharing:false}}));set('subscription:disconnect',()=>{connected=false;return {status:'error',error:{code:'revocation_failed',message:'本地登录凭据已清除，但远端撤销未确认'}};});set('subscription:models',()=>({status:'ok',value:[{slug:'fixture',displayName:'Fixture'}]}));set('subscription-task:state',()=>({status:'ok',value:task}));set('subscription-task:prepare',async(_e,_id,_folder,model)=>{await new Promise(resolve=>setTimeout(resolve,400));return {status:'ok',value:task={status:'ready',model,accountLabel:'test@example.test',sourcePath:'sample.txt',outputPath:'sample.md'}};});set('results:list',()=>({status:'ok',value:sent?[{id:'fake',name:'合成笔记.md',sourceName:'sample.txt',createdAt:new Date().toISOString()}]:[]}));set('subscription-task:start',()=>{sent++;return {status:'ok',value:task={status:'done',resultId:'fake'}};});set('subscription-task:cancel',()=>({status:'ok',value:task={status:'idle'}}));});
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'ChatGPT 订阅'}).click();await page.getByText(/已连接 test@example.test/).waitFor();await page.getByRole('button',{name:'获取可用模型'}).click();await page.getByText(/可用模型：Fixture/).waitFor();await page.getByRole('button',{name:'退出登录'}).click();await page.getByText('尚未连接',{exact:true}).waitFor();await page.getByText(/远端撤销未确认/).waitFor();await page.getByRole('button',{name:'返回文件工作台'}).click();
 const pick=path=>app.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});},path);await pick(sources);const tree=page.getByRole('region',{name:'资料文件夹'});await tree.getByRole('button',{name:'打开资料文件夹'}).click();await tree.getByRole('treeitem',{name:'sample.txt'}).click();const panel=page.getByRole('region',{name:'批量整理'});await panel.getByRole('button',{name:'批量整理（1）'}).click();await pick(notes);await panel.getByRole('button',{name:'选择笔记文件夹'}).click();const picker=page.getByRole('dialog',{name:'选择笔记保存位置'});await picker.getByRole('button',{name:'打开笔记文件夹'}).click();await picker.getByRole('button',{name:'使用此文件夹'}).click();await panel.getByLabel('整理服务').selectOption('subscription');await panel.getByRole('button',{name:'检查资料'}).click();await panel.getByLabel('补充整理要求').fill('修改后的要求');await page.waitForTimeout(600);assert.equal(await panel.getByRole('button',{name:'确认发送'}).count(),0);await panel.getByRole('button',{name:'检查资料'}).click();await panel.getByText(/账户 test@example.test/).waitFor();await panel.getByRole('button',{name:'取消确认'}).click();await panel.getByRole('button',{name:'确认发送'}).waitFor({state:'hidden'});await panel.getByRole('button',{name:'检查资料'}).click();await panel.getByRole('button',{name:'确认发送'}).click();await panel.getByText('合成笔记.md').waitFor();
});
test('encrypted synthetic subscription is restored after a real desktop restart',{timeout:60000},async t=>{
 const target=electronTestTarget(),base=target.artifacts;mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,'subscription-restart-ui-'));const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile')};delete env.ELECTRON_RUN_AS_NODE;let app;
 const launch=()=>electron.launch({executablePath:target.executablePath,args:target.args,env});t.after(async()=>{if(app)await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});
 const value={version:2,activeProfileId:'fixture',pendingRegistrations:[],profiles:[{version:1,id:'fixture',label:'Synthetic',clientId:'fixture-client',status:'connected',scopes:['chatgpt.tokens.use.direct'],savedAt:new Date().toISOString(),identity:{email:'test@example.test'},credentials:{accessToken:'synthetic-restart-secret',expiresAt:Date.now()+3600000}}]};
 app=await launch();const ciphertext=await app.evaluate(({safeStorage},data)=>safeStorage.encryptString(JSON.stringify(data)).toString('base64'),value);await app.close();app=undefined;
 const path=join(own,'profile','subscription');mkdirSync(path,{recursive:true});writeFileSync(join(path,'chatgpt-auth.json'),JSON.stringify({version:3,provider:'electron-safe-storage-v1',ciphertext}));
 assert.doesNotMatch(readFileSync(join(path,'chatgpt-auth.json'),'utf8'),/synthetic-restart-secret/);app=await launch();const page=await app.firstWindow();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'ChatGPT 订阅'}).click();await page.getByText(/已连接 test@example.test/).waitFor();const result=await page.evaluate(()=>window.clipnote.subscriptionState());assert.equal(result.value.sharing,true);assert.doesNotMatch(JSON.stringify(result),/synthetic-restart-secret/);
});

test('subscription network session remains separate from renderer blocking',{timeout:60000},async t=>{
 const target=electronTestTarget(),base=target.artifacts;mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,'subscription-network-ui-'));let calls=0;const server=createServer((_req,res)=>{calls++;res.end('synthetic');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/`;const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile')};delete env.ELECTRON_RUN_AS_NODE;let app;
 t.after(async()=>{if(app)await app.close();await new Promise(resolve=>server.close(resolve));assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});app=await electron.launch({executablePath:target.executablePath,args:target.args,env});const page=await app.firstWindow();
 const isolated=await app.evaluate(async({session},url)=>{const response=await session.fromPartition('clipnote-subscription').fetch(url);return response.text();},url);assert.equal(isolated,'synthetic');assert.equal(calls,1);
 const blocked=await page.evaluate(url=>fetch(url).then(()=>false,()=>true),url);assert.equal(blocked,true);assert.equal(calls,1);
});
