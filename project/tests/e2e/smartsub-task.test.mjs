import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
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
    else if(op==='tasks.get'){const {p,noSub}=JSON.parse(fs.readFileSync(state));v=a.id==='fixture-transcribe'?{id:a.id,status:'completed',artifacts:[{kind:'srt',path:p}]}:{id:'fixture-task',status:'completed',result:noSub?{artifacts:[{kind:'video',path:p}]}:{downloadEntries:[{subtitlePaths:[p]}]}};}
    else if(op==='settings.get')v={defaults:{transcriptionEngine:'builtin',model:'small'}};
    else if(op==='engines.list')v={builtin:{state:'ready'}};
    else if(op==='models.list')v={modelsInstalled:['small']};
    else if(op==='transcribe'){fs.mkdirSync(a.outputDir,{recursive:true});const p=path.join(a.outputDir,'转写字幕.srt');fs.writeFileSync(p,'1\\n00:00:01,000 --> 00:00:02,000\\n合成视频字幕\\n');fs.writeFileSync(state,JSON.stringify({p}));v={id:'fixture-transcribe',status:'running'};}
    else if(op==='subtitles.read')v={filePath:a.filePath,version:'v1',format:'srt',total:1,offset:0,cues:[{startMs:1000,endMs:2000,text:'合成视频字幕'}]};
    else throw Error('unexpected '+op);process.stdout.write(JSON.stringify(v));});`);
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:profile,CLIPNOTE_TEST_SMARTSUB_ROOT:install};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});
  t.after(async()=>{await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.getByRole('button',{name:'视频链接',exact:true}).click();
  await page.getByText('SmartSub 3.10.1',{exact:false}).waitFor();await page.getByLabel('视频链接').fill('https://example.invalid/synthetic');
  await page.getByRole('button',{name:'确认并开始获取字幕'}).click();await page.getByText('任务：正在获取字幕').waitFor();
  await page.getByRole('button',{name:'查询状态'}).click();await page.getByText('任务：获取完成').waitFor();
  await page.getByRole('button',{name:'使用字幕 1'}).click();await page.getByText('合成视频字幕').first().waitFor();
  await page.getByRole('button',{name:'视频链接',exact:true}).click();await page.getByText('SmartSub 3.10.1',{exact:false}).waitFor();
  await page.getByRole('button',{name:'查询状态'}).click();await page.getByText('任务：获取完成').waitFor();
  await page.getByLabel('视频链接').fill('https://example.invalid/no-sub');await page.getByRole('button',{name:'确认并开始获取字幕'}).click();await page.getByText('任务：正在获取字幕').waitFor();
  await page.getByRole('button',{name:'查询状态'}).click();await page.getByText('没有找到可用字幕',{exact:false}).waitFor();
  await page.getByRole('button',{name:'检查转写资源'}).click();await page.getByText('本地引擎：builtin',{exact:false}).waitFor();
  await page.getByRole('button',{name:'确认并开始或恢复转写'}).click();await page.getByText('转写：正在获取字幕').waitFor();
  await page.getByRole('button',{name:'查询转写状态'}).click();await page.getByText('转写：获取完成').waitFor();await page.getByRole('button',{name:'使用转写字幕 1'}).click();await page.getByText('合成视频字幕').first().waitFor();
});
