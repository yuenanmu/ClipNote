import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';

test('API settings save an encrypted key and only send a synthetic test when explicitly requested', { timeout: 120000 }, async t => {
  const artifacts = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url)); mkdirSync(artifacts, { recursive: true }); const own = mkdtempSync(join(artifacts, 'api-e2e-'));
  const secret = 'synthetic-window-secret'; let calls = 0, modelCalls = 0, received;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') { modelCalls++; assert.equal(request.headers.authorization, `Bearer ${secret}`); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture' }, { id: 'other' }] })); return; }
    calls++; const chunks = []; for await (const part of request) chunks.push(part); const body = JSON.parse(Buffer.concat(chunks).toString()); received = { auth: request.headers.authorization, body };
    const content = body.messages.at(-1).content; const input = JSON.parse(content.split('\n')[1]); const ref = input.core[0]; const { segmentId, startOffset, endOffset } = ref; const refs = [{ segmentId, startOffset, endOffset }];
    const value = JSON.stringify({ title: '测试', sections: [{ heading: '章节', refs, items: [{ kind: 'point', text: '合成', refs, children: [] }] }] });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: value }, finish_reason: null }] })}\n\n`); response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`); response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}/v1`;
  const env = { ...process.env, CLIPNOTE_TEST_USER_DATA: join(own, 'profile') }; delete env.ELECTRON_RUN_AS_NODE; let app;
  const launch = async () => { app = await electron.launch({ executablePath: electronPath, args: [fileURLToPath(new URL('../../dist/main/index.cjs', import.meta.url))], env, timeout: 30000 }); const page = await app.firstWindow(); page.setDefaultTimeout(8000); return page; };
  t.after(async () => { if (app) await app.close(); await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); assert.equal(resolve(dirname(own)), resolve(artifacts)); rmSync(own, { recursive: true, force: true }); });
  let page = await launch(); await page.getByRole('button', { name: 'API 设置', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '返回文件工作台' }).count(), 1);
  await page.getByLabel('服务地址').fill('https://platform.deepseek.com'); await page.getByRole('button', { name: '使用 API 地址' }).click(); assert.equal(await page.getByLabel('服务地址').inputValue(), 'https://api.deepseek.com');
  await page.getByLabel('服务地址').fill(base); await page.getByLabel('API 密钥').fill(secret);
  await page.getByLabel('服务地址').fill(`${base}/changed`); assert.equal(await page.getByLabel('API 密钥').inputValue(), ''); assert.equal(modelCalls, 0);
  await page.getByLabel('服务地址').fill(base); await page.getByLabel('API 密钥').fill(secret);
  await page.getByRole('button', { name: '获取模型列表' }).click(); await page.getByLabel('选择模型').selectOption('fixture'); assert.equal(modelCalls, 1); assert.equal(calls, 0); assert.equal(await page.getByLabel('模型名称').inputValue(), 'fixture');
  await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.getByText('设置已安全保存', { exact: true }).waitFor();
  assert.equal(calls, 0); assert.equal((await page.evaluate(() => window.clipnote.apiState())).value.configured, true); assert.ok(!JSON.stringify(await page.evaluate(() => window.clipnote.apiState())).includes(secret));
  assert.ok(!readFileSync(join(own, 'profile', 'api', 'api.json'), 'utf8').includes(secret));
  await app.close(); app = undefined; page = await launch(); await page.getByRole('button', { name: 'API 设置', exact: true }).click();
  await page.waitForFunction(expected => document.querySelector('input[aria-label="服务地址"]')?.value === expected, base);
  assert.equal(await page.getByLabel('服务地址').inputValue(), base); assert.equal(await page.getByLabel('API 密钥').inputValue(), ''); assert.equal(calls, 0);
  await page.getByRole('button', { name: '获取模型列表' }).click(); await page.getByLabel('选择模型').waitFor(); assert.equal(modelCalls, 2); assert.equal(calls, 0);
  await page.screenshot({ path: join(artifacts, 'api-settings-models.png') });
  await page.getByRole('button', { name: '测试连接', exact: true }).click(); await page.locator('.api-panel .notice').waitFor(); assert.equal(await page.locator('.api-panel .notice').innerText(), '连接测试通过');
  assert.equal(calls, 1); assert.equal(received.auth, `Bearer ${secret}`); assert.ok(JSON.stringify(received.body).includes('合成连接测试'));
});
