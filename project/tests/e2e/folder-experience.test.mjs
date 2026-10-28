import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';

test('explorer works on real files with icons, keyboard, nested drag and main-area editing',{timeout:120000},async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,'folder-redesign-'));
  const sources=join(own,'资料'),notes=join(own,'笔记');mkdirSync(sources);mkdirSync(notes);writeFileSync(join(sources,'a.txt'),'合成 A');writeFileSync(join(sources,'b.txt'),'合成 B');mkdirSync(join(sources,'主题 A'));mkdirSync(join(sources,'主题 A','二级'));writeFileSync(join(notes,'初始.md'),'# 阅读');
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile')};delete env.ELECTRON_RUN_AS_NODE;const app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});
  t.after(async()=>{await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});const page=await app.firstWindow();page.setDefaultTimeout(10000);
  const pick=async(path,label)=>{await app.evaluate(({dialog},value)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[value]});},path);await page.getByRole('button',{name:label,exact:true}).click();};
  await pick(sources,'打开资料文件夹');const tree=page.getByRole('tree',{name:'资料文件树'});await tree.getByRole('treeitem',{name:'a.txt',exact:true}).click();await page.getByRole('heading',{name:'a.txt',exact:true}).waitFor();
  await tree.getByRole('treeitem',{name:'b.txt',exact:true}).click({modifiers:['Control']});assert.equal(await tree.locator('[aria-selected=true]').count(),2);
  await tree.getByRole('treeitem',{name:'b.txt',exact:true}).press('Control+x');await tree.getByRole('treeitem',{name:'主题 A',exact:true}).click();await tree.getByRole('treeitem',{name:'主题 A',exact:true}).press('Control+v');
  await page.waitForFunction(()=>document.querySelector('[role=tree]')?.textContent?.includes('移动完成'));assert.equal(readFileSync(join(sources,'主题 A','a.txt'),'utf8'),'合成 A');
  const first=tree.getByRole('treeitem',{name:'a.txt',exact:true});await first.click();await first.press('F2');const rename=tree.getByRole('textbox',{name:'文件名称'});await rename.fill('改名.txt');await rename.press('Enter');await tree.getByRole('treeitem',{name:'改名.txt',exact:true}).waitFor();assert.equal(existsSync(join(sources,'主题 A','改名.txt')),true);
  await tree.getByRole('treeitem',{name:'改名.txt',exact:true}).dragTo(tree.getByRole('treeitem',{name:'二级',exact:true}));for(let n=0;n<50 && !existsSync(join(sources,'主题 A','二级','改名.txt'));n++)await page.waitForTimeout(50);assert.equal(existsSync(join(sources,'主题 A','二级','改名.txt')),true);assert.equal(existsSync(join(sources,'改名.txt')),false);
  await page.getByRole('button',{name:'笔记',exact:true}).click();await pick(notes,'打开笔记文件夹');await page.getByRole('button',{name:'新建笔记',exact:true}).click();const input=page.getByRole('textbox',{name:'文件名称'});await input.fill('新笔记.md');await input.press('Enter');
  await page.getByRole('textbox',{name:'编辑 Markdown'}).fill('# 新笔记\n\n正文');assert.equal(await page.locator('.workspace-editor').count(),0);await page.getByRole('button',{name:'保存笔记',exact:true}).click();await page.getByRole('region',{name:'Markdown 编辑区'}).getByText('笔记已保存。',{exact:true}).waitFor();assert.equal(readFileSync(join(notes,'新笔记.md'),'utf8'),'# 新笔记\n\n正文');
  assert.equal(existsSync(join(notes,'ClipNote')),false);await page.screenshot({path:join(base,'folder-experience.png')});
});

async function isolated(t,prefix){
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,prefix));const env={...process.env,CLIPNOTE_TEST_USER_DATA:join(own,'profile')};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});t.after(async()=>{await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});const page=await app.firstWindow();page.setDefaultTimeout(10000);
  return {own,page,app,pick:async(path,label)=>{await app.evaluate(({dialog},value)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[value]});},path);await page.getByRole('button',{name:label,exact:true}).click();}};
}

test('search results drag, external synchronization and recycle-bin confirmation act on the actual files',{timeout:120000},async t=>{
  const f=await isolated(t,'folder-watch-'),notes=join(f.own,'笔记');mkdirSync(notes);mkdirSync(join(notes,'主题'));writeFileSync(join(notes,'笔记.md'),'# 初始内容');writeFileSync(join(notes,'丢弃.md'),'synthetic disposable');
  await f.page.getByRole('button',{name:'笔记',exact:true}).click();await f.pick(notes,'打开笔记文件夹');const tree=f.page.getByRole('tree',{name:'笔记文件树'});
  await tree.getByRole('treeitem',{name:'笔记.md',exact:true}).click();await f.page.getByRole('button',{name:'编辑笔记',exact:true}).click();await f.page.getByRole('textbox',{name:'编辑 Markdown'}).fill('# 我的未保存修改');writeFileSync(join(notes,'笔记.md'),'# 外部修改');
  await f.page.getByRole('alert').filter({hasText:'文件已被外部修改'}).waitFor();await f.page.getByRole('button',{name:'保存笔记',exact:true}).click();await f.page.getByRole('alert').filter({hasText:'文件已存在或已被外部修改'}).waitFor();assert.equal(readFileSync(join(notes,'笔记.md'),'utf8'),'# 外部修改');
  await f.page.getByRole('button',{name:'文件导入',exact:true}).click();const unsaved=f.page.getByRole('dialog',{name:'未保存的修改'});await unsaved.getByRole('button',{name:'继续编辑'}).click();assert.equal(await f.page.getByRole('textbox',{name:'编辑 Markdown'}).inputValue(),'# 我的未保存修改');
  await f.app.evaluate(({dialog,BrowserWindow})=>{dialog.showMessageBoxSync=()=>{globalThis.__closeAsked=true;return 0;};BrowserWindow.getAllWindows()[0].close();});assert.equal(await f.app.evaluate(()=>globalThis.__closeAsked),true);assert.equal(await f.page.getByRole('textbox',{name:'编辑 Markdown'}).inputValue(),'# 我的未保存修改');
  await f.page.getByRole('button',{name:'阅读',exact:true}).click();await unsaved.getByRole('button',{name:'放弃更改'}).click();
  writeFileSync(join(notes,'新出现.md'),'# 外部新建');await tree.getByRole('treeitem',{name:'新出现.md',exact:true}).waitFor();
  await f.page.getByRole('button',{name:'搜索文件',exact:true}).click();await f.page.getByRole('textbox',{name:'搜索文件',exact:true}).fill('笔记');await tree.getByText('1 项',{exact:true}).waitFor();
  const row=tree.getByRole('treeitem',{name:'笔记.md',exact:true});await row.dragTo(tree.getByRole('treeitem',{name:/^根目录/}));await tree.getByRole('status').filter({hasText:'目标同名'}).waitFor();assert.equal(readFileSync(join(notes,'笔记.md'),'utf8'),'# 外部修改');
  await f.page.getByRole('textbox',{name:'搜索文件',exact:true}).fill('');await tree.getByRole('treeitem',{name:'丢弃.md',exact:true}).click();await tree.getByRole('treeitem',{name:'丢弃.md',exact:true}).press('Delete');const confirm=f.page.getByRole('dialog',{name:'确认移入回收站'});await confirm.getByRole('button',{name:'取消',exact:true}).click();assert.equal(existsSync(join(notes,'丢弃.md')),true);
  await tree.getByRole('treeitem',{name:'丢弃.md',exact:true}).press('Delete');await confirm.getByRole('button',{name:'确认移入回收站'}).click();for(let n=0;n<100 && existsSync(join(notes,'丢弃.md'));n++)await f.page.waitForTimeout(50);assert.equal(existsSync(join(notes,'丢弃.md')),false);
});

test('5,000 files keep the tree virtualized and the minimum window remains usable',{timeout:120000},async t=>{
  const f=await isolated(t,'folder-large-'),notes=join(f.own,'大量笔记');mkdirSync(notes);for(let i=0;i<5000;i++)writeFileSync(join(notes,String(i).padStart(5,'0')+'.md'),'# 合成笔记');
  await f.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,680));await f.page.getByRole('button',{name:'笔记',exact:true}).click();await f.pick(notes,'打开笔记文件夹');const tree=f.page.getByRole('tree',{name:'笔记文件树'});await tree.getByRole('treeitem',{name:'00000.md',exact:true}).waitFor();
  assert.ok(await tree.getByRole('treeitem').count()<65);for(let n=0;n<100 && !await tree.getByRole('treeitem',{name:'04999.md',exact:true}).count();n++){await tree.evaluate(element=>{element.scrollTop=element.scrollHeight;});await f.page.waitForTimeout(70);}await tree.getByRole('treeitem',{name:'04999.md',exact:true}).click();await f.page.getByRole('heading',{name:'04999.md',exact:true}).waitFor();assert.ok(await tree.getByRole('treeitem').count()<65);
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await f.page.getByRole('separator',{name:'调整文件侧栏宽度'}).press('ArrowRight');await f.page.screenshot({path:join(dirname(f.own),'folder-large-minimum.png')});
});

test('typing during a delayed save stays in the editor and search allows inline creation',{timeout:120000},async t=>{
  const f=await isolated(t,'folder-save-'),notes=join(f.own,'notes');mkdirSync(notes);writeFileSync(join(notes,'sample.md'),'# Initial');await f.page.getByRole('button',{name:'笔记',exact:true}).click();await f.pick(notes,'打开笔记文件夹');await f.page.getByRole('treeitem',{name:'sample.md',exact:true}).click();await f.page.getByRole('button',{name:'编辑笔记',exact:true}).click();
  await f.app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('workspace:action');ipcMain.removeHandler('workspace:action');ipcMain.handle('workspace:action',async(event,kind,action,...args)=>{const result=await original(event,kind,action,...args);if(action==='save'){globalThis.__delayedSave=true;await new Promise(resolve=>setTimeout(resolve,400));}return result;});});
  const editor=f.page.getByRole('textbox',{name:'编辑 Markdown'});await editor.fill('# Saved snapshot');await f.page.getByRole('button',{name:'保存笔记',exact:true}).click();for(let n=0;n<50 && !await f.app.evaluate(()=>globalThis.__delayedSave);n++)await f.page.waitForTimeout(10);await editor.fill('# New typing after save');await f.page.getByRole('button',{name:'保存笔记',exact:true}).waitFor({state:'visible'});await f.page.waitForFunction(()=>!document.querySelector('.note-editor-pane .primary')?.disabled);assert.equal(await editor.inputValue(),'# New typing after save');assert.equal(readFileSync(join(notes,'sample.md'),'utf8'),'# Saved snapshot');
  await f.page.getByRole('button',{name:'阅读',exact:true}).click();await f.page.getByRole('dialog',{name:'未保存的修改'}).getByRole('button',{name:'放弃更改'}).click();await f.page.getByRole('button',{name:'搜索文件',exact:true}).click();await f.page.getByRole('textbox',{name:'搜索文件',exact:true}).fill('sample');await f.page.getByRole('tree').filter({has: f.page.getByRole('treeitem',{name:'sample.md',exact:true})}).getByText('1 项',{exact:true}).waitFor();await f.page.getByRole('button',{name:'新建笔记',exact:true}).click();const filename=f.page.getByRole('textbox',{name:'文件名称'});await filename.waitFor();await filename.fill('created.md');await filename.press('Enter');for(let n=0;n<50 && !existsSync(join(notes,'created.md'));n++)await f.page.waitForTimeout(20);assert.equal(existsSync(join(notes,'created.md')),true);
});
