import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';

test('unknown old task explains the disabled start and explicit recovery clears its stale error',{timeout:60000},async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,'smartsub-recovery-'));
  const profile=join(own,'profile'),install=join(profile,'SmartSub'),cli=join(install,'resources','automation','cli.cjs'),submitted=join(dirname(cli),'submitted');mkdirSync(dirname(cli),{recursive:true});copyFileSync(process.execPath,join(install,'SmartSub.exe'));
  writeFileSync(cli,`const fs=require('fs'),path=require('path');let raw='';process.stdin.on('data',v=>raw+=v);process.stdin.on('end',()=>{const op=process.argv.slice(2,-3).join('.');if(op==='system.capabilities' && fs.existsSync(path.join(__dirname,'connection-fails'))){process.exitCode=1;process.stdout.write('{}');return;}let value;if(op==='system.info')value={version:'3.10.1',apiVersion:1,profile:__dirname};else if(op==='system.capabilities')value=['downloads.start','tasks.get','tasks.cancel','subtitles.read'].map(name=>({name}));else if(op==='downloads.engines')value=[{engine:'yt-dlp',installed:{version:'fixture'}}];else if(op==='downloads.start'){fs.writeFileSync(path.join(__dirname,'submitted'),'yes');value={id:'new-task',status:'running'};}else if(op==='tasks.get')value={id:'new-task',status:'running'};else throw Error('unexpected');process.stdout.write(JSON.stringify(value));});`);
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:profile,CLIPNOTE_TEST_SMARTSUB_ROOT:install};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});
  t.after(async()=>{await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});
  const page=await app.firstWindow();page.setDefaultTimeout(10000);
  await page.evaluate(()=>localStorage.setItem('clipnote.smartsub.task','00000000-0000-4000-8000-000000000001'));await page.reload();
  await page.getByRole('button',{name:'视频链接',exact:true}).click();await page.getByText('SmartSub 3.10.1 · 已连接',{exact:true}).waitFor();
  await page.getByLabel('视频链接',{exact:true}).fill('https://example.invalid/new');
  await page.getByText('无法确认旧任务状态，开始新任务前请先处理旧任务。',{exact:true}).waitFor();
  await page.getByText('暂时无法更新任务状态：',{exact:false}).waitFor();
  assert.match(await page.getByText('暂时无法更新任务状态：',{exact:false}).innerText(),/缺失|损坏/);
  await page.screenshot({path:join(base,'smartsub-unknown-task.png')});
  assert.equal(await page.getByRole('button',{name:'确认并开始获取字幕',exact:true}).isDisabled(),true);assert.equal(existsSync(submitted),false);
  await page.getByRole('button',{name:'放弃跟踪此任务',exact:true}).click();await page.getByRole('button',{name:'确认放弃跟踪',exact:true}).click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('clipnote.smartsub.task')),null);
  assert.equal(await page.getByText('暂时无法更新任务状态',{exact:false}).count(),0);
  assert.equal(await page.getByRole('button',{name:'确认并开始获取字幕',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'确认并开始获取字幕',exact:true}).click();await page.getByText('任务：正在获取字幕',{exact:true}).waitFor();assert.equal(existsSync(submitted),true);
  // A connection failure must not remain labelled as connecting, and rechecking can recover.
  await page.evaluate(()=>localStorage.removeItem('clipnote.smartsub.task'));writeFileSync(join(dirname(cli),'connection-fails'),'synthetic');await page.reload();
  await page.getByRole('button',{name:'视频链接',exact:true}).click();await page.getByLabel('视频链接',{exact:true}).fill('https://example.invalid/another');
  await page.getByText('SmartSub 连接检查失败',{exact:true}).waitFor();assert.equal(await page.getByText('正在连接 SmartSub…',{exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'确认并开始获取字幕',exact:true}).isDisabled(),true);
  rmSync(join(dirname(cli),'connection-fails'));await page.getByRole('button',{name:'重新检测连接',exact:true}).click();
  await page.getByText('SmartSub 3.10.1 · 已连接',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'确认并开始获取字幕',exact:true}).isEnabled(),true);

});
