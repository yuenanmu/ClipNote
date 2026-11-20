import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {_electron as electron} from 'playwright';
import {electronTestTarget} from './electron-target.mjs';

async function workbench(t){
  const target=electronTestTarget();
  mkdirSync(target.artifacts,{recursive:true});
  const own=mkdtempSync(join(target.artifacts,'workbench-preferences-'));
  const source=join(own,'样例.txt');
  writeFileSync(source,'验证工作台偏好设置。');
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile')};
  delete env.ELECTRON_RUN_AS_NODE;
  let app,page;
  t.after(async()=>{
    if(app)await app.close();
    assert.equal(resolve(dirname(own)),resolve(target.artifacts));
    rmSync(own,{recursive:true,force:true});
  });
  const launch=async()=>{
    app=await electron.launch({executablePath:target.executablePath,args:target.args,env});
    page=await app.firstWindow();
    page.setDefaultTimeout(6000);
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},source);
    return page;
  };
  const restart=async()=>{await app.close();app=undefined;return launch();};
  const openSource=async()=>{
    await page.getByRole('button',{name:'打开文件',exact:true}).click();
    await page.getByRole('heading',{name:'样例.txt',exact:true}).waitFor();
  };
  return {launch,restart,openSource,artifacts:target.artifacts};
}

test('organizer switches built-in prompts, preserves old instructions and saves editable templates', {timeout:60000}, async t=>{
  const ui=await workbench(t);
  let page=await ui.launch();
  const select=()=>page.getByRole('combobox',{name:'提示词模板',exact:true});
  const open=()=>page.getByRole('button',{name:'AI 整理',exact:true}).click();
  const editor=()=>page.getByRole('dialog',{name:'提示词模板'});
  const view=()=>page.getByRole('button',{name:'查看 / 编辑',exact:true}).click();

  await ui.openSource();
  await open();
  assert.equal(await select().inputValue(),'standard');
  assert.equal(await page.getByRole('textbox',{name:'提示词内容'}).count(),0);
  await page.evaluate(()=>localStorage.setItem('clipnote.analysis.instructions','保留历史操作示例'));
  page=await ui.restart();
  await ui.openSource();
  await open();
  assert.equal(await select().locator('option:checked').textContent(),'原有补充要求');
  await view();
  assert.equal(await editor().getByLabel('提示词内容').inputValue(),'保留历史操作示例');
  await editor().press('Escape');
  await editor().waitFor({state:'hidden'});

  await select().selectOption({label:'详细'});
  await view();
  assert.match(await editor().getByLabel('提示词内容').inputValue(),/实例/);
  await editor().getByLabel('模板名称').fill('教程复盘');
  await editor().getByLabel('提示词内容').fill('保留操作示例，按步骤列出。');
  await editor().getByRole('button',{name:'保存为自定义模板'}).click();
  await editor().waitFor({state:'hidden'});
  assert.equal(await select().locator('option:checked').textContent(),'教程复盘');
  await select().selectOption({label:'简略'});
  await select().selectOption({label:'教程复盘'});
  await view();
  assert.equal(await editor().getByLabel('提示词内容').inputValue(),'保留操作示例，按步骤列出。');
  await editor().getByLabel('提示词内容').fill('同时提取未解决的问题。');
  await editor().getByRole('button',{name:'保存模板',exact:true}).click();

  page=await ui.restart();
  await ui.openSource();
  await open();
  assert.equal(await select().locator('option:checked').textContent(),'教程复盘');
  assert.equal(await select().locator('option').filter({hasText:'详细'}).count(),1);
  await view();
  assert.equal(await editor().getByLabel('提示词内容').inputValue(),'同时提取未解决的问题。');
  await page.screenshot({path:join(ui.artifacts,'prompt-template-editor.png')});
});

test('the persistent sidebar toggle expands the work area without replacing the current page', {timeout:60000}, async t=>{
  const ui=await workbench(t);
  let page=await ui.launch();
  await ui.openSource();
  const hide=()=>page.getByRole('button',{name:'隐藏侧边栏',exact:true});
  const show=()=>page.getByRole('button',{name:'显示侧边栏',exact:true});
  const content=()=>page.locator('.file-content').boundingBox();
  assert.equal(await hide().evaluate(button=>getComputedStyle(button).borderRadius),'6px');
  const expanded=await content();
  await hide().press('Enter');
  assert.equal(await show().getAttribute('aria-expanded'),'false');
  assert.ok((await content()).width>=expanded.width+160);
  await page.getByRole('heading',{name:'样例.txt',exact:true}).waitFor();
  assert.equal(await page.getByRole('separator',{name:'调整文件侧栏宽度'}).count(),0);
  await page.screenshot({path:join(ui.artifacts,'sidebar-collapsed.png')});
  await show().click();
  assert.equal((await content()).width,expanded.width);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await hide().click();
  await page.getByRole('heading',{name:'设置',exact:true}).waitFor();

  page=await ui.restart();
  await show().waitFor();
  await show().click();
  await page.getByRole('button',{name:'视频队列',exact:true}).waitFor();
});
