import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';

test('SmartSub installation discovery uses a system picker and persists only validated paths',{timeout:60000},async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,'smartsub-discovery-'));
  const install=join(own,'中文 SmartSub'),bad=join(own,'wrong');mkdirSync(join(install,'resources','automation'),{recursive:true});mkdirSync(bad);
  writeFileSync(join(install,'SmartSub.exe'),'synthetic');writeFileSync(join(install,'resources','automation','cli.cjs'),'synthetic');
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile'),CLIPNOTE_TEST_SMARTSUB_ROOT:bad};delete env.ELECTRON_RUN_AS_NODE;let app;
  t.after(async()=>{if(app)await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});
  app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});
  const page=await app.firstWindow();await page.getByRole('button',{name:'视频链接',exact:true}).click();
  await page.getByText('尚未找到 SmartSub',{exact:true}).waitFor();
  const pick=path=>app.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]});},path);
  await pick(bad);await page.getByRole('button',{name:'选择安装文件夹'}).click();await page.getByRole('alert').filter({hasText:'没有完整的 SmartSub'}).waitFor();
  await pick(install);await page.getByRole('button',{name:'选择安装文件夹'}).click();await page.getByText('已找到 SmartSub',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.clipnote.smartsubState('unwanted'))).status,'error');
  await app.close();app=undefined;
  app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});const restarted=await app.firstWindow();
  await restarted.getByRole('button',{name:'视频链接',exact:true}).click();await restarted.getByText('已找到 SmartSub',{exact:true}).waitFor();
  await restarted.evaluate(()=>localStorage.setItem('clipnote.smartsub.task','00000000-0000-4000-8000-000000000001'));await restarted.reload();await restarted.getByRole('button',{name:'视频链接',exact:true}).click();
  await restarted.getByRole('button',{name:'放弃跟踪此任务'}).click();await restarted.getByText('不会取消 SmartSub 后台任务',{exact:false}).waitFor();
  await restarted.getByRole('button',{name:'确认放弃跟踪'}).click();assert.equal(await restarted.evaluate(()=>localStorage.getItem('clipnote.smartsub.task')),null);
});
