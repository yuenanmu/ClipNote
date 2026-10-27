import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';

test('real desktop imports sources locally and preserves the security boundary', { timeout: 120_000 }, async t => {
  const artifacts = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url));
  mkdirSync(artifacts, { recursive: true });
  const own = mkdtempSync(join(artifacts, 'desktop-'));
  const env = { ...process.env, CLIPNOTE_TEST_USER_DATA: join(own, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: electronPath, args: [fileURLToPath(new URL('../../dist/main/index.cjs', import.meta.url))], env, timeout: 30_000 });
  t.after(async () => { await app.close(); assert.equal(resolve(dirname(own)), resolve(artifacts)); rmSync(own, { recursive: true, force: true }); });
  const page = await app.firstWindow();
  page.setDefaultTimeout(6000);
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  const choose = async path => app.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => selectedPath ? { canceled: false, filePaths: [selectedPath] } : { canceled: true, filePaths: [] }; }, path);
  const importPath = async path => {
    await choose(path);
    await page.getByRole('button', { name: '导入文件', exact: true }).click();
  };

  await t.test('shows a useful empty desktop and isolated capabilities', async () => {
    await page.getByRole('button', { name: '选择本地文件', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.deepEqual(await page.evaluate(() => Object.keys(window.clipnote).sort()), ['apiState','apiSave','apiTest','apiCancel','chooseLibrary','importSource','libraryState','openRevision','resumeSave','saveSource','readerOpen','readerRevision','readerRefresh','readerExternal','readerLink','noteList','noteAdd','noteOpen','noteRemove','noteRelink','noteSource'].sort());
    const preferences = await app.evaluate(({ BrowserWindow }) => { const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration }; });
    assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    await page.screenshot({ path: join(artifacts, 'desktop-empty.png') });
  });
  await t.test('cancelled selection stays usable and supplied paths are rejected', async () => {
    await choose(undefined);
    await page.getByRole('button', { name: '选择本地文件', exact: true }).click();
    await page.getByText('已取消选择', { exact: true }).waitFor();
    const invalid = await page.evaluate(() => window.clipnote.importSource('D:/private.txt'));
    assert.equal(invalid.status, 'error');
    assert.equal(invalid.error.code, 'FORBIDDEN_REQUEST');
  });
  await t.test('SRT shows real timestamps, exact original text and line navigation', async () => {
    const file = fileURLToPath(new URL('../fixtures/示例 字幕.srt', import.meta.url));
    await importPath(file);
    await page.getByRole('heading', { name: basename(file), exact: true }).waitFor();
    await page.getByRole('button', { name: '定位片段 2', exact: true }).click();
    await page.getByTestId('source-location').filter({ hasText: '第 7–8 行' }).waitFor();
    await page.getByRole('button', { name: '原始文本', exact: true }).click();
    assert.match(await page.getByTestId('raw-source').textContent(), /00:00:04,500 --> 00:00:08,000/);
    await page.getByRole('button', { name: '来源片段', exact: true }).click();
    await page.screenshot({ path: join(artifacts, 'desktop-imported.png') });
  });
  await t.test('VTT, UTF-16 TXT and script-containing Markdown stay local plain text', async () => {
    const cases = [
      ['合成.vtt', Buffer.from('WEBVTT\n\n00:01.000 --> 00:02.000\nVTT 合成片段')],
      ['中文 空格.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('UTF16 中文资料\r\n\r\n下一段', 'utf16le')])],
      ['资料.md', Buffer.from('# 合成标题\n\n<script>window.injectedBySource=true</script>\n![图片](https://example.invalid/private.png)')],
    ];
    for (const [name, content] of cases) {
      const file = join(own, name); writeFileSync(file, content);
      await importPath(file);
      await page.getByRole('heading', { name, exact: true }).waitFor();
    }
    await page.getByRole('button', { name: '原始文本', exact: true }).click();
    assert.match(await page.getByTestId('raw-source').textContent(), /<script>/);
    assert.equal(await page.evaluate(() => window.injectedBySource), undefined);
    assert.equal(await page.locator('img').count(), 0);
    assert.equal(await page.evaluate(async () => { try { await fetch('https://example.invalid'); return 'unexpected'; } catch { return 'blocked'; } }), 'blocked');
  });
  await t.test('long sources paginate and can reveal original text beyond the first preview', async () => {
    const large = join(own, '长资料.txt');
    writeFileSync(large, Array.from({ length: 201 }, (_, index) => `第${index + 1}段 ` + '合成内容'.repeat(350)).join('\n\n'));
    await importPath(large);
    await page.getByRole('heading', { name: '长资料.txt', exact: true }).waitFor();
    assert.equal(await page.locator('.segment').count(), 100);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.getByRole('button', { name: '定位片段 101', exact: true }).waitFor();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await page.getByRole('button', { name: '定位片段 201', exact: true }).click();
    await page.getByRole('button', { name: '查看原文位置', exact: true }).click();
    assert.match(await page.getByTestId('raw-source').locator('mark').textContent(), /第201段/);
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    assert.match(await page.getByTestId('raw-source').textContent(), /^第1段/);
    await importPath(join(own, '资料.md'));
    await page.getByRole('heading', { name: '资料.md', exact: true }).waitFor();
  });
  await t.test('invalid input retains the previous source and subsequent imports recover', async () => {
    const broken = join(own, '损坏.srt'); writeFileSync(broken, '字幕没有时间戳');
    await importPath(broken);
    await page.getByRole('alert').filter({ hasText: '字幕格式不完整' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '资料.md', exact: true }).count(), 1);
    const valid = join(own, '恢复.txt'); writeFileSync(valid, '恢复后的内容');
    await importPath(valid);
    await page.getByRole('heading', { name: '恢复.txt', exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.deepEqual(pageErrors, []);
  });
});
