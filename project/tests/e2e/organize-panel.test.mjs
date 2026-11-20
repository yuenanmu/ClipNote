import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {_electron as electron} from 'playwright';
import {electronTestTarget} from './electron-target.mjs';

test('AI organizer resizes from its bottom edge and preserves the source viewport', {timeout:60000}, async t => {
  const target=electronTestTarget();
  mkdirSync(target.artifacts,{recursive:true});
  const fixture=mkdtempSync(join(target.artifacts,'organize-layout-'));
  const source=join(fixture,'合成资料.txt');
  writeFileSync(source,'这是用来验证整理区布局的资料。');
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(fixture,'profile')};
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  t.after(async()=>{
    if(app) await app.close();
    assert.equal(resolve(dirname(fixture)),resolve(target.artifacts));
    rmSync(fixture,{recursive:true,force:true});
  });

  async function launch() {
    app=await electron.launch({executablePath:target.executablePath,args:target.args,env});
    const page=await app.firstWindow();
    page.setDefaultTimeout(10000);
    await app.evaluate(({BrowserWindow,dialog},path)=>{
      BrowserWindow.getAllWindows()[0].setSize(1260,850);
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});
    },source);
    await page.getByRole('button',{name:'打开文件',exact:true}).click();
    await page.getByRole('button',{name:'AI 整理',exact:true}).click();
    return page;
  }

  let page=await launch();
  const separator=()=>page.getByRole('separator',{name:'调整 AI 整理面板高度'});
  await separator().waitFor({timeout:4000});
  await separator().press('ArrowUp');
  const prior=Number(await separator().getAttribute('aria-valuenow'));
  const grip=await separator().boundingBox();
  assert.ok(grip);
  const x=grip.x+grip.width/2;
  const y=grip.y+grip.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+48,{steps:5});
  await page.mouse.up();
  const expanded=Number(await separator().getAttribute('aria-valuenow'));
  assert.equal(expanded,prior+48);
  await page.screenshot({path:join(target.artifacts,'v3-organize.png')});

  const previousLimit=Number(await separator().getAttribute('aria-valuemax'));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,680));
  await page.waitForFunction(limit=>Number(document.querySelector('.batch-height-handle')?.getAttribute('aria-valuemax'))<limit,previousLimit);
  await separator().press('End');
  assert.equal(await separator().getAttribute('aria-valuenow'),await separator().getAttribute('aria-valuemax'));
  const viewport=await page.locator('.source-desktop .workspace').boundingBox();
  assert.ok(viewport && viewport.height>=150,'source stays usable at the smallest window size');
  await page.screenshot({path:join(target.artifacts,'v3-organize-minimum.png')});
  await separator().press('Home');
  assert.equal(await separator().getAttribute('aria-valuenow'),await separator().getAttribute('aria-valuemin'));
  await page.getByRole('button',{name:'收起整理面板'}).click();
  await page.getByRole('button',{name:'AI 整理',exact:true}).click();
  const saved=await separator().getAttribute('aria-valuenow');
  assert.equal(saved,await separator().getAttribute('aria-valuemin'));
  await app.close();
  app=undefined;
  page=await launch();
  assert.equal(await separator().getAttribute('aria-valuenow'),saved);
});
