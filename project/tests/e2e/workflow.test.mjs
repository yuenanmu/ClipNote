import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';

test('single opened files use the direct-note workflow with confirmation, timing and persistent instructions', { timeout: 120000 }, async t => {
  const artifacts = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url)); mkdirSync(artifacts, { recursive: true });
  const own = mkdtempSync(join(artifacts, 'workflow-ui-')), output = join(own, 'output'); mkdirSync(output);
  const input = join(own, 'source.txt'), original = '测试原文，整理时保留来源。'; writeFileSync(input, original);
  const secret = 'synthetic-workflow-secret'; let calls = 0, fail = false;
  const server = createServer(async (request, response) => {
    calls++; assert.equal(request.headers.authorization, `Bearer ${secret}`);
    const parts = []; for await (const part of request) parts.push(part);
    if (fail) { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{}'); return; }
    const body = JSON.parse(Buffer.concat(parts).toString()), data = JSON.parse(body.messages.at(-1).content.split('\n')[1]); assert.equal(data.userInstructions, '保留操作示例');
    if (calls === 1) { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: '{' }, finish_reason: null }] })}\n\n`); response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'length' }] })}\n\n`); response.end('data: [DONE]\n\n'); return; }
    await new Promise(resolve => setTimeout(resolve, 60)); const { segmentId, startOffset, endOffset } = data.core[0], refs = [{ segmentId, startOffset, endOffset }];
    const value = JSON.stringify({ title: '整理结果', sections: [{ heading: '要点', refs, items: [{ kind: 'point', text: '测试笔记内容', refs, children: [] }] }] });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: value }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`); response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const env = { ...process.env, CLIPNOTE_TEST_USER_DATA: join(own, 'profile') }; delete env.ELECTRON_RUN_AS_NODE; let app;
  t.after(async () => { if (app) await app.close(); await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); assert.equal(resolve(dirname(own)), resolve(artifacts)); rmSync(own, { recursive: true, force: true }); });
  app = await electron.launch({ executablePath: electronPath, args: [fileURLToPath(new URL('../../dist/main/index.cjs', import.meta.url))], env });
  let page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const libraryState = async () => { for (let i = 0; i < 50; i++) { const result = await page.evaluate(() => window.clipnote.libraryState()); if (result.status === 'ok') return result.value; await page.waitForTimeout(100); } throw new Error('library state stayed busy'); };
  const config = await page.evaluate(input => window.clipnote.apiSave(input), { baseUrl, model: 'fixture', contextWindow: 8192, maxTokens: 2048, apiKey: secret }); assert.equal(config.status, 'ok');
  const picker = path => app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, path);
  await page.getByRole('button',{name:'笔记',exact:true}).click();await picker(output);await page.getByRole('button',{name:'打开笔记文件夹',exact:true}).click();await page.getByRole('tree',{name:'笔记文件树'}).waitFor();await page.getByRole('button',{name:'文件导入',exact:true}).click();
  await picker(input);await page.getByRole('button',{name:'打开文件',exact:true}).click();await page.getByRole('heading',{name:'source.txt',exact:true}).waitFor();
  const sourceRoot=await page.evaluate(()=>window.clipnote.workspace('source','root'));assert.equal(sourceRoot.value,undefined);
  await page.getByRole('button',{name:'AI 整理',exact:true}).click();await page.getByLabel('补充整理要求').fill('保留操作示例');await page.getByRole('button',{name:'保存补充要求',exact:true}).click();await page.getByText('补充要求已保存到本机。',{exact:true}).waitFor();assert.equal(calls,0);
  await app.close();app=await electron.launch({executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],env});page=await app.firstWindow();page.setDefaultTimeout(15000);
  await picker(input);await page.getByRole('button',{name:'打开文件',exact:true}).click();await page.getByRole('heading',{name:'source.txt',exact:true}).waitFor();await page.getByRole('button',{name:'AI 整理',exact:true}).click();assert.equal(await page.getByLabel('补充整理要求').inputValue(),'保留操作示例');
  const panel=page.getByRole('region',{name:'批量整理'});await panel.getByRole('button',{name:'检查所选文件'}).click();const confirmation=panel.getByRole('region',{name:'确认发送资料'});await confirmation.waitFor();assert.equal(calls,0);assert.match(await confirmation.innerText(),/fixture/);await confirmation.getByRole('button',{name:'取消',exact:true}).click();assert.equal(calls,0);
  await panel.getByRole('button',{name:'检查所选文件'}).click();await panel.getByRole('button',{name:'确认发送并开始'}).click();await panel.locator('.batch-item.succeeded').waitFor();assert.equal(calls,3);await panel.getByText(/本次耗时：准备/).waitFor();
  const finished=await page.evaluate(()=>window.clipnote.batchState());assert.equal(finished.value.items[0].timing.requests,3);assert.ok(finished.value.items[0].timing.apiMs>=100);
  const target=join(output,'source.md');assert.match(readFileSync(target,'utf8'),/测试笔记内容/);assert.doesNotMatch(readFileSync(target,'utf8'),/clipnote-source:|↗来源|段落\d+ · 字符/);assert.equal(readFileSync(input,'utf8'),original);assert.equal(existsSync(join(output,'ClipNote')),false);assert.equal((await libraryState()).revisions.length,0);
  await page.getByRole('button',{name:'笔记',exact:true}).click();await page.getByRole('treeitem',{name:'source.md',exact:true}).click();await page.getByRole('button',{name:'展开全部',exact:true}).click();await page.getByRole('button',{name:/选择节点 测试笔记内容/}).first().click();await page.getByRole('button',{name:'查看 Markdown',exact:true}).click();await page.getByTestId('reader-body').getByText('测试笔记内容',{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:/回查来源|查看来源/}).count(),0);
  await page.getByRole('button',{name:'文件导入',exact:true}).click();writeFileSync(target,'人工编辑，未确认不覆盖');fail=true;await page.getByRole('button',{name:'AI 整理',exact:true}).click();await panel.getByRole('button',{name:'检查所选文件'}).click();await panel.getByText('将覆盖已关联笔记',{exact:true}).waitFor();assert.equal(readFileSync(target,'utf8'),'人工编辑，未确认不覆盖');await panel.getByRole('button',{name:'确认发送并开始'}).click();await panel.locator('.batch-item.failed').waitFor();assert.equal(calls,4);assert.equal(readFileSync(target,'utf8'),'人工编辑，未确认不覆盖');
  await panel.getByRole('button',{name:'恢复默认',exact:true}).click();assert.equal(await page.getByLabel('补充整理要求').inputValue(),'');assert.equal(await page.evaluate(()=>localStorage.getItem('clipnote.analysis.instructions')),null);await page.screenshot({path:join(artifacts,'workflow-direct-note.png')});
});
