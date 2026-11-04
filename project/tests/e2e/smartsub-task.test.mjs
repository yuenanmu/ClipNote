import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';

test('video link uses the task bridge and opens the obtained synthetic subtitle',{timeout:60000},async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,'smartsub-flow-'));
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
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:profile,CLIPNOTE_TEST_SMARTSUB_ROOT:install};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});
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
