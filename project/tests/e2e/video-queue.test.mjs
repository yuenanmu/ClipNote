import {electronTestTarget} from './electron-target.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,copyFileSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {_electron as electron} from 'playwright';

test('video queue keeps running across pages and copies an original subtitle without changing the active document',{timeout:90000},async t=>{
  const target=electronTestTarget(),base=target.artifacts;mkdirSync(base,{recursive:true});
  const own=mkdtempSync(join(base,'video-queue-')),profile=join(own,'profile'),sources=join(own,'资料');
  const install=join(profile,'SmartSub'),cli=join(install,'resources','automation','cli.cjs');
  mkdirSync(sources);mkdirSync(dirname(cli),{recursive:true});copyFileSync(process.execPath,join(install,'SmartSub.exe'));
  const expected='1\r\n00:00:01,000 --> 00:00:02,000\r\n合成原字幕\r\n';
  writeFileSync(join(sources,'原字幕.srt'),'既有文件');
  writeFileSync(cli,`const fs=require('fs'),path=require('path');let input='';
    process.stdin.on('data',data=>input+=data);
    process.stdin.on('end',()=>{const a=JSON.parse(input),op=process.argv.slice(2,-3).join('.');let value;
    if(op==='system.info')value={version:'3.10.1',apiVersion:1,profile:__dirname};
    else if(op==='system.capabilities')value=['downloads.start','tasks.get','tasks.cancel','subtitles.read','transcribe','settings.get','engines.list','models.list'].map(name=>({name}));
    else if(op==='downloads.engines')value=[{engine:'yt-dlp',installed:{version:'fixture'}}];
    else if(op==='settings.get')value={defaults:{transcriptionEngine:'builtin',model:'small'}};
    else if(op==='engines.list')value={builtin:{state:'ready'}};
    else if(op==='models.list')value={modelsInstalled:['small']};
    else if(op==='downloads.start'){
      const id='d-'+a.requestId,wantsModel=a.config.entries[0].url.endsWith('/first');
      const file=path.join(a.config.savePath,wantsModel?'音频.mp4':'原字幕.srt');
      fs.writeFileSync(file,wantsModel?'synthetic':${JSON.stringify(expected)});
      fs.writeFileSync(path.join(__dirname,id+'.json'),JSON.stringify({file,wantsModel}));
      value={id,status:'running'};
    }else if(op==='transcribe'){
      const id='t-'+a.requestId;fs.mkdirSync(a.outputDir,{recursive:true});
      const file=path.join(a.outputDir,'转写.txt');fs.writeFileSync(file,'合成转写原文');
      fs.writeFileSync(path.join(__dirname,id+'.json'),JSON.stringify({file}));
      value={id,status:'running'};
    }else if(op==='tasks.get'){
      const {file,wantsModel}=JSON.parse(fs.readFileSync(path.join(__dirname,a.id+'.json')));
      value=a.id.startsWith('t-')&&!fs.existsSync(path.join(__dirname,'release'))
        ? {id:a.id,status:'running'}
        : {id:a.id,status:'completed',result:a.id.startsWith('t-')?{artifacts:[{kind:'txt',path:file}]}
          :wantsModel?{artifacts:[{kind:'video',path:file}]}:{downloadEntries:[{subtitlePaths:[file]}]}};
    }else if(op==='subtitles.read'){
      value={filePath:a.filePath,version:'v1',format:'srt',total:1,offset:0,cues:[{startMs:1000,endMs:2000,text:'合成原字幕'}]};
    }else throw Error('unexpected '+op);process.stdout.write(JSON.stringify(value));});`);
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:profile,CLIPNOTE_TEST_SMARTSUB_ROOT:install};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:target.executablePath,args:target.args,env});
  t.after(async()=>{await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  await app.evaluate(({dialog},value)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[value]});},sources);
  const nav=page.getByRole('button',{name:/^视频队列/});
  await nav.click();await page.getByLabel('批量链接',{exact:true}).fill('https://example.invalid/first\nhttps://example.invalid/second');
  await page.getByRole('button',{name:'确认并开始获取字幕',exact:true}).click();
  await page.getByRole('button',{name:'笔记',exact:true}).click();
  await nav.getByText('1 进行中 · 0 待处理',{exact:true}).waitFor();
  await nav.click();
  const ready=page.getByRole('listitem').filter({hasText:'https://example.invalid/second'});
  await page.getByText('正在转写',{exact:true}).waitFor({timeout:5000}).catch(async error=>{
    await page.screenshot({path:join(base,'video-queue-diagnostic.png')});
    t.diagnostic(await page.locator('.video-slot').innerHTML());
    t.diagnostic(JSON.stringify(await page.evaluate(()=>window.clipnote.videoQueue({type:'state'}))));
    throw error;
  });
  await ready.getByRole('button',{name:'预览字幕'}).click();
  await ready.getByText('合成原字幕',{exact:true}).waitFor();
  await page.screenshot({path:join(base,'video-queue-v3.png')});
  await ready.getByRole('button',{name:'打开原文'}).click();
  await page.getByRole('heading',{name:'原字幕.srt',exact:true}).waitFor();
  await page.getByRole('button',{name:'复制到资料'}).click();
  await page.getByText('请先在左侧选择资料文件夹。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'打开资料文件夹',exact:true}).click();
  await page.getByRole('treeitem',{name:/^根目录/}).waitFor();
  await page.getByRole('heading',{name:'原字幕.srt',exact:true}).waitFor();
  await page.getByRole('button',{name:'复制到资料'}).click();
  await page.getByRole('button',{name:'在资料中定位'}).click();
  const copied=page.getByRole('treeitem',{name:'原字幕 (2).srt',exact:true});
  await copied.and(page.locator('.revealed')).waitFor();
  assert.equal(await page.getByRole('heading',{name:'原字幕.srt',exact:true}).isVisible(),true);
  assert.equal(readFileSync(join(sources,'原字幕 (2).srt'),'utf8'),expected);
  assert.equal(readFileSync(join(sources,'原字幕.srt'),'utf8'),'既有文件');
  assert.doesNotMatch(readFileSync(join(profile,'smartsub','video-queue.json'),'utf8'),/https:\/\/example\.invalid/);
  writeFileSync(join(dirname(cli),'release'),'yes');
  await nav.click();
  const first=page.getByRole('listitem').filter({hasText:'https://example.invalid/first'});
  await first.getByRole('button',{name:'打开原文'}).waitFor();
  const output=readdirSync(dirname(cli)).find(name=>name.startsWith('t-')&&name.endsWith('.json'));
  assert.ok(output);
  const original=JSON.parse(readFileSync(join(dirname(cli),output),'utf8')).file;
  writeFileSync(original,'');
  await first.getByRole('button',{name:'预览字幕'}).click();
  await first.getByText('SmartSub 已完成，但生成的字幕为空。可以重试转写。',{exact:true}).waitFor();
  await first.getByRole('button',{name:'打开原文'}).waitFor({state:'hidden'});
  await first.getByRole('button',{name:'重试',exact:true}).click();
  await first.getByRole('button',{name:'打开原文'}).waitFor();
  assert.equal(readdirSync(dirname(cli)).filter(name=>name.startsWith('t-')&&name.endsWith('.json')).length,2);
  assert.equal(readFileSync(original,'utf8'),'');
});
