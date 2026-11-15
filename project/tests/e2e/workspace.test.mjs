import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron} from 'playwright';
import electronPath from 'electron';
import {StorageService} from '../../src/modules/storage/service.ts';
import {parseSource} from '../../src/modules/source/parser.ts';

test('legacy archives stay separate and export actual latest Markdown without changing archive bytes',{timeout:120000},async t=>{
  const base=fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url));mkdirSync(base,{recursive:true});const own=mkdtempSync(join(base,'legacy-export-ui-')),notes=join(own,'笔记'),profile=join(own,'profile');mkdirSync(notes);
  const store=new StorageService(join(profile,'storage'));await store.chooseDirectory(notes);const bytes=Buffer.from('合成原文'),snapshot={bytes,document:parseSource(bytes,join(own,'资料.txt'))},meta={kind:'generated-note',model:'fixture',promptVersion:'fixture'};
  await store.save(snapshot,'# 旧版本',meta);const latest=await store.save(snapshot,'# 最新版本',meta);writeFileSync(latest.notePath,'# 人工修改\n\n导出的详细内容。');const original=readFileSync(latest.notePath),sourceBytes=readFileSync(latest.sourcePath),manifest=readFileSync(latest.manifestPath);writeFileSync(join(notes,'资料.md'),'existing');
  const env={...process.env,CLIPNOTE_TEST_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;const app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});t.after(async()=>{await app.close();assert.equal(resolve(dirname(own)),resolve(base));rmSync(own,{recursive:true,force:true});});const page=await app.firstWindow();page.setDefaultTimeout(10000);
  await page.getByRole('button',{name:'笔记',exact:true}).click();await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},notes);await page.getByRole('button',{name:'打开笔记文件夹'}).click();const tree=page.getByRole('tree',{name:'笔记文件树'});await tree.getByRole('treeitem',{name:'资料.md',exact:true}).waitFor();assert.equal(await tree.getByRole('treeitem',{name:'ClipNote',exact:true}).count(),0);
  await page.getByRole('button',{name:'旧归档',exact:true}).click();const archive=page.getByRole('dialog',{name:'旧归档',exact:true});await archive.getByRole('button',{name:'导出最新笔记'}).click();const filename=archive.getByRole('textbox',{name:'导出文件名 资料.txt'});await filename.waitFor();assert.equal(await filename.inputValue(),'资料 (2).md');await filename.fill('资料.md');await archive.getByRole('button',{name:'确认导出'}).click();await archive.getByText('已导出 0 项，失败 1 项。',{exact:true}).waitFor();assert.equal(readFileSync(join(notes,'资料.md'),'utf8'),'existing');
  await filename.fill('导出结果.md');await archive.getByRole('button',{name:'确认导出'}).click();await archive.getByText('已导出 1 项，失败 0 项。',{exact:true}).waitFor();assert.equal(readFileSync(join(notes,'导出结果.md'),'utf8'),'# 人工修改\n\n导出的详细内容。');assert.deepEqual(readFileSync(latest.notePath),original);assert.deepEqual(readFileSync(latest.sourcePath),sourceBytes);assert.deepEqual(readFileSync(latest.manifestPath),manifest);
  await archive.getByRole('button',{name:'关闭旧归档'}).click();await tree.getByRole('treeitem',{name:'导出结果.md',exact:true}).click();await page.getByRole('button',{name:'Markdown',exact:true}).click();await page.getByTestId('reader-body').getByText('导出的详细内容。',{exact:true}).waitFor();assert.equal(existsSync(join(notes,'ClipNote')),true);await page.screenshot({path:join(base,'archive-export.png')});
});
