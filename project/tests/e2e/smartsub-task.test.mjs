import {electronTestTarget} from './electron-target.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,copyFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';

test('video link uses the task bridge and opens the obtained synthetic subtitle',{timeout:120000},async t=>{
  const target=electronTestTarget(),base=target.artifacts;mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,'smartsub-flow-'));
  const profile=join(own,'profile'),install=join(profile,'中文 空格 SmartSub'),cli=join(install,'resources','automation','cli.cjs');mkdirSync(dirname(cli),{recursive:true});copyFileSync(process.execPath,join(install,'SmartSub.exe'));
  writeFileSync(cli,`const fs=require('fs'),path=require('path');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{const a=JSON.parse(s),op=process.argv.slice(2,-3).join('.'),state=path.join(__dirname,'fixture.json');let v;
    if(op==='system.info')v={version:'3.10.1',apiVersion:1,profile:__dirname};
    else if(op==='system.capabilities')v=['downloads.start','tasks.get','tasks.cancel','subtitles.read','transcribe','settings.get','engines.list','models.list'].map(name=>({name}));
    else if(op==='downloads.engines')v=[{engine:'yt-dlp',installed:{version:'fixture'}}];
    else if(op==='downloads.start'){const noSub=a.config.entries[0].url.endsWith('no-sub');const p=path.join(a.config.savePath,noSub?'合成视频.mp4':'合成字幕.srt');fs.writeFileSync(p,noSub?'synthetic':'1\\n00:00:01,000 --> 00:00:02,000\\n合成视频字幕\\n');fs.writeFileSync(state,JSON.stringify({p,noSub}));v={id:'fixture-task',status:'running'};}
    else if(op==='tasks.cancel'){fs.writeFileSync(state,JSON.stringify({...JSON.parse(fs.readFileSync(state)),cancelled:true}));fs.unlinkSync(path.join(__dirname,'hold-transcription'));v={id:a.id,status:'cancelled'};}
    else if(op==='tasks.get' && a.id==='fixture-transcribe' && fs.existsSync(path.join(__dirname,'hold-transcription'))){fs.writeFileSync(path.join(__dirname,'query-started'),'yes');setTimeout(()=>process.stdout.write(JSON.stringify({id:a.id,status:'running'})),2000);return;}
    else if(op==='tasks.get'){const {p,noSub,transcript,cancelled}=JSON.parse(fs.readFileSync(state));v=a.id==='fixture-transcribe'?{id:a.id,status:cancelled?'cancelled':'completed',artifacts:[{kind:'txt',path:transcript},{kind:'srt',path:path.join(__dirname,'private-intermediate.srt')}]}:{id:'fixture-task',status:'completed',result:noSub?{artifacts:[{kind:'video',path:p}]}:{downloadEntries:[{subtitlePaths:[p]}]}};}
    else if(op==='settings.get')v={defaults:{transcriptionEngine:'builtin',model:'small'}};
    else if(op==='engines.list')v={builtin:{state:'ready'}};
    else if(op==='models.list')v={modelsInstalled:['small','medium']};
    else if(op==='transcribe'){fs.mkdirSync(a.outputDir,{recursive:true});const p=path.join(a.outputDir,'转写字幕.txt');fs.writeFileSync(p,'合成视频字幕');fs.writeFileSync(state,JSON.stringify({...JSON.parse(fs.readFileSync(state)),transcript:p,cancelled:false}));v={id:'fixture-transcribe',status:'running'};}
    else if(op==='subtitles.read')v={filePath:a.filePath,version:'v1',format:'srt',total:1,offset:0,cues:[{startMs:1000,endMs:2000,text:'合成视频字幕'}]};
    else throw Error('unexpected '+op);process.stdout.write(JSON.stringify(v));});`);
  let calls=0, receivedSubtitle=false;
  const server=createServer(async(req,res)=>{const chunks=[];for await(const part of req)chunks.push(part);const body=JSON.parse(Buffer.concat(chunks).toString());const data=JSON.parse(body.messages.at(-1).content.split('\n')[1]);calls++;receivedSubtitle ||= data.core.some(item=>item.text.includes('合成视频字幕'));const refs=data.core.map(({segmentId,startOffset,endOffset})=>({segmentId,startOffset,endOffset}));const text=JSON.stringify({title:'链接整理结果',sections:[{heading:'要点',refs,items:[{kind:'point',text:'字幕整理后的合成笔记',refs,children:[]}]}]});res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})}\n\n`);res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\n`);res.end('data: [DONE]\n\n');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:profile,CLIPNOTE_TEST_SMARTSUB_ROOT:install};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:target.executablePath,args:target.args,env});
  t.after(async()=>{await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.getByRole('button',{name:'视频链接',exact:true}).click();
  assert.equal(await page.getByRole('navigation',{name:'工作区'}).isVisible(),true,'video stays inside the workspace shell');
  await page.getByRole('button',{name:'SmartSub 设置',exact:true}).click();
  await page.getByLabel('转写引擎').selectOption('builtin');await page.getByLabel('转写模型').selectOption('medium');
  await page.getByRole('button',{name:'保存转写设置',exact:true}).click();await page.getByText('转写设置已保存',{exact:true}).waitFor();
  await page.screenshot({path:join(base,'smartsub-settings.png')});
  await page.getByRole('button',{name:'返回文件工作台',exact:true}).click();
  await page.getByText('SmartSub 3.10.1',{exact:false}).waitFor();await page.getByLabel('视频链接').fill('https://example.invalid/synthetic');
  await page.getByRole('button',{name:'确认并开始获取字幕'}).click();
  await page.getByRole('button',{name:'SmartSub 设置',exact:true}).click();await page.getByLabel('转写模型').waitFor();assert.equal(await page.getByLabel('转写模型').inputValue(),'medium');
  await page.getByRole('button',{name:'返回文件工作台',exact:true}).click();assert.equal(await page.getByLabel('视频链接').inputValue(),'https://example.invalid/synthetic');
  await page.getByText('任务：获取完成').waitFor();
  await page.screenshot({path:join(base,'smartsub-workspace.png')});
  await page.setViewportSize({width:900,height:650});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(base,'smartsub-workspace-narrow.png')});
  await page.getByRole('button',{name:'使用字幕 1'}).click();await page.getByText('合成视频字幕').first().waitFor();
  const config=await page.evaluate(input=>window.clipnote.apiSave(input),{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',contextWindow:8192,maxTokens:2048,apiKey:'synthetic-key'});assert.equal(config.status,'ok');
  const apiNotes=join(own,'api-notes');mkdirSync(apiNotes);await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},apiNotes);
  const apiBatch=page.getByRole('region',{name:'批量整理'});await apiBatch.getByRole('button',{name:'批量整理（1）'}).click();await apiBatch.getByRole('button',{name:'选择笔记文件夹'}).click();const apiPicker=page.getByRole('dialog',{name:'选择笔记保存位置'});await apiPicker.getByRole('button',{name:'打开笔记文件夹'}).click();await apiPicker.getByRole('button',{name:'使用此文件夹'}).click();await apiBatch.getByRole('button',{name:'检查所选文件'}).click();assert.equal(calls,0);await apiBatch.getByRole('button',{name:'确认发送并开始'}).click();await apiBatch.locator('.batch-item.succeeded').waitFor();assert.ok(calls>0);assert.equal(receivedSubtitle,true);assert.match(readFileSync(join(apiNotes,'合成字幕.md'),'utf8'),/字幕整理后的合成笔记/);
  await page.getByRole('button',{name:'笔记',exact:true}).click();await page.getByRole('treeitem',{name:'合成字幕.md',exact:true}).click();await page.getByRole('button',{name:'展开全部',exact:true}).click();await page.getByRole('button',{name:/选择节点 字幕整理后的合成笔记/}).first().click();await page.getByRole('button',{name:'查看 Markdown',exact:true}).click();await page.getByTestId('reader-body').getByText('字幕整理后的合成笔记',{exact:true}).first().waitFor();await page.getByRole('button',{name:'文件导入',exact:true}).click();
  const notes=join(own,'notes');mkdirSync(notes);await app.evaluate(({ipcMain,dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});ipcMain.removeHandler('subscription:models');ipcMain.handle('subscription:models',()=>({status:'ok',value:[{slug:'fixture',displayName:'Fixture'}]}));ipcMain.removeHandler('subscription-task:state');ipcMain.handle('subscription-task:state',()=>({status:'ok',value:{status:'idle'}}));ipcMain.removeHandler('subscription-task:prepare');ipcMain.handle('subscription-task:prepare',(_event,id,_folder,model)=>{if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('Missing workspace entry');return {status:'ok',value:{status:'ready',model,accountLabel:'synthetic',sourcePath:id,outputPath:'合成笔记.md'}};});},notes);
  const batch=page.getByRole('region',{name:'批量整理'});await batch.getByRole('button',{name:'批量整理（1）'}).click();await batch.getByLabel('整理服务').selectOption('subscription');await batch.getByRole('button',{name:'检查资料'}).click();await batch.getByText(/账户 synthetic/).waitFor();const imported=await page.evaluate(async()=>{const result=await window.clipnote.subscriptionTaskState();return result.status;});assert.equal(imported,'ok');

  await page.getByRole('button',{name:'视频链接',exact:true}).click();await page.getByText('SmartSub 3.10.1',{exact:false}).waitFor();
  await page.getByText('任务：获取完成').waitFor();
  await page.getByLabel('视频链接').fill('https://example.invalid/no-sub');await page.getByRole('button',{name:'确认并开始获取字幕'}).click();
  await page.getByText('没有找到可用字幕',{exact:false}).waitFor();
  await page.getByText('本地引擎：builtin；模型：medium',{exact:false}).waitFor();
  await page.getByRole('button',{name:'确认并开始或恢复转写'}).click();
  await page.getByText('转写：转写完成').waitFor();await page.reload();await page.getByRole('button',{name:'视频链接',exact:true}).click();await page.getByText('转写：转写完成').waitFor();await page.getByRole('button',{name:'使用转写字幕 1'}).click();await page.getByText('合成视频字幕').first().waitFor();
  await page.getByRole('button',{name:'视频链接',exact:true}).click();await page.getByLabel('视频链接').fill('https://example.invalid/no-sub');await page.getByRole('button',{name:'确认并开始获取字幕'}).click();
  await page.getByText('本地引擎：builtin；模型：medium',{exact:false}).waitFor();writeFileSync(join(dirname(cli),'hold-transcription'),'synthetic');
  await page.getByRole('button',{name:'确认并开始或恢复转写'}).click();await page.getByText('转写：正在转写',{exact:true}).waitFor();
  const queryMarker=join(dirname(cli),'query-started');for(let i=0;i<100 && !existsSync(queryMarker);i++)await new Promise(resolve=>setTimeout(resolve,30));assert.ok(existsSync(queryMarker));
  await page.getByText('恢复与任务操作',{exact:true}).click();await page.getByRole('button',{name:'查询转写状态',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'取消此转写',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'取消此转写',exact:true}).click();await page.getByText('转写：已取消',{exact:true}).waitFor({timeout:1500});
  await new Promise(resolve=>setTimeout(resolve,2300));assert.equal(await page.getByText('转写：已取消',{exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'确认并重试转写',exact:true}).click();await page.getByText('转写：转写完成',{exact:true}).waitFor();

});
