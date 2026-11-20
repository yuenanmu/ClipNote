import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {_electron as electron} from 'playwright';
import {electronTestTarget} from './electron-target.mjs';

test('content panels and opened select menus share the workbench palette', {timeout:60000}, async t=>{
  const target=electronTestTarget();
  mkdirSync(target.artifacts,{recursive:true});
  const fixture=mkdtempSync(join(target.artifacts,'desktop-theme-'));
  const source=join(fixture,'合成字幕.txt'),notes=join(fixture,'笔记');
  mkdirSync(notes);
  writeFileSync(source,'先确认资料来源。\n\n再选择需要整理的重点。\n\n最后检查整理结果。');
  writeFileSync(join(notes,'整理笔记.md'),'# 整理笔记\n\n## 处理过程\n\n- 确认资料来源\n- 提取关键观点\n\n> 保留能够核对的原文依据。');
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(fixture,'profile')};
  delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:target.executablePath,args:target.args,env});
  t.after(async()=>{
    await app.close();
    assert.equal(resolve(dirname(fixture)),resolve(target.artifacts));
    rmSync(fixture,{recursive:true,force:true});
  });
  const page=await app.firstWindow();
  page.setDefaultTimeout(8000);
  const config=await page.evaluate(()=>window.clipnote.apiSaveProfile({
    name:'合成 API 服务',baseUrl:'http://127.0.0.1:1234/v1',model:'fixture-model',
    contextWindow:8192,maxTokens:2048,apiKey:'synthetic-theme-key',
  }));
  assert.equal(config.status,'ok');
  const pick=path=>app.evaluate(({dialog},value)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[value]});},path);
  await pick(source);
  await page.getByRole('button',{name:'打开文件',exact:true}).click();
  await page.getByRole('heading',{name:'合成字幕.txt',exact:true}).waitFor();
  await page.getByRole('button',{name:'AI 整理',exact:true}).click();
  const select=page.getByRole('combobox',{name:'提示词模板'});
  await select.waitFor();
  const closed=await select.evaluate(element=>{
    const button=getComputedStyle(element),menu=getComputedStyle(element,'::picker(select)');
    return {appearance:button.appearance,radius:menu.borderRadius,background:menu.backgroundImage};
  });
  assert.equal(closed.appearance,'base-select');
  assert.ok(parseFloat(closed.radius)>=8,'the expanded menu has rounded corners');
  assert.match(closed.background,/gradient/);
  const apiSelect=page.getByRole('combobox',{name:/本次使用的 API 服务/});
  await apiSelect.click();
  await page.waitForFunction(()=>Boolean(document.querySelector('.batch-fields select:open')));
  await page.screenshot({path:join(target.artifacts,'v3-harmonized-api-picker.png')});
  await page.keyboard.press('Escape');

  await select.click();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="提示词模板"]')?.matches(':open'));
  await page.screenshot({path:join(target.artifacts,'v3-harmonized-picker.png')});
  await page.keyboard.press('Escape');
  assert.equal(await select.inputValue(),'standard');
  await select.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(()=>document.querySelector('select[aria-label="提示词模板"]')?.matches(':open'));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await select.inputValue(),'concise');
  await page.screenshot({path:join(target.artifacts,'v3-harmonized-source.png')});
  const background=locator=>locator.evaluate(element=>getComputedStyle(element).backgroundImage);
  const paper=await background(page.getByRole('region',{name:'来源工作区'}));
  assert.match(paper,/gradient/);
  assert.match(await background(page.locator('.batch-detail')),/gradient/);

  await page.getByRole('button',{name:'笔记',exact:true}).click();
  await pick(notes);
  await page.getByRole('button',{name:'打开笔记文件夹',exact:true}).click();
  await page.getByRole('treeitem',{name:'整理笔记.md',exact:true}).click();
  await page.getByRole('button',{name:'对照',exact:true}).click();
  const reading=page.locator('.reader-scroll').filter({visible:true});
  assert.equal(await background(reading),paper);
  await page.screenshot({path:join(target.artifacts,'v3-harmonized-reading.png')});
  await page.getByRole('button',{name:'编辑笔记',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'编辑 Markdown'});
  assert.equal(await background(editor),paper);
  await page.screenshot({path:join(target.artifacts,'v3-harmonized-editor.png')});
});
