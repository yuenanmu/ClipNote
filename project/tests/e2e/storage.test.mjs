import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';
import { StorageService } from '../../src/modules/storage/service.ts';
import { parseSource } from '../../src/modules/source/parser.ts';

test('desktop archives sources, keeps versions and resumes saved drafts across restarts', { timeout: 120_000 }, async t => {
  const base = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url)); mkdirSync(base, { recursive: true });
  const own = mkdtempSync(join(base, 'storage-ui-')), profile = join(own, 'profile'), output = join(own, '归档位置'); mkdirSync(output);
  const input = join(own, '来源 UTF16.txt'), raw = Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from('原文必须完整保留\r\n\r\n第二段', 'utf16le')]); writeFileSync(input, raw);
  let app, page;
  const start = async () => { const env = { ...process.env, CLIPNOTE_TEST_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE; app = await electron.launch({ executablePath: electronPath, args: [fileURLToPath(new URL('../../dist/main/index.cjs', import.meta.url))], env }); page = await app.firstWindow(); page.setDefaultTimeout(8000); };
  const stop = async () => { if (app) { await app.close(); app = undefined; } };
  const picker = async path => app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => selected ? { canceled: false, filePaths: [selected] } : { canceled: true, filePaths: [] }; }, path);
  const state = async () => { await page.getByRole('button', { name: '导入文件', exact: true }).waitFor(); const value = await page.evaluate(() => window.clipnote.libraryState()); assert.equal(value.status, 'ok', JSON.stringify(value)); return value.value; };
  t.after(async () => { await stop(); assert.equal(resolve(dirname(own)), resolve(base)); rmSync(own, { recursive: true, force: true }); });
  await start();
  await page.getByRole('button', { name: '选择保存目录', exact: true }).waitFor();
  let first;
  await t.test('cancel leaves no output; choosing a directory and saving preserves the imported bytes', async () => {
    await picker(undefined); await page.getByRole('button', { name: '选择保存目录', exact: true }).click();
    await page.getByText('已取消目录选择', { exact: true }).waitFor(); assert.equal((await state()).directory, null);
    await picker(input); await page.getByRole('button', { name: '导入文件', exact: true }).click();
    await page.getByRole('heading', { name: '来源 UTF16.txt', exact: true }).waitFor();
    writeFileSync(input, '导入之后被修改的文件');
    await picker(output); await page.getByRole('button', { name: '选择保存目录', exact: true }).click();
    await page.getByRole('button', { name: '更改目录', exact: true }).waitFor();
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await page.getByText('来源已保存，已创建独立版本。', { exact: true }).waitFor();
    const library = await state(); assert.equal(library.revisions.length, 1); first = library.revisions[0];
    assert.ok(first.directory.startsWith(output)); assert.deepEqual(readFileSync(first.sourcePath), raw);
    assert.match(readFileSync(first.notePath, 'utf8'), /尚未进行 AI 整理/);
  });
  await t.test('another save creates a version and preserves externally edited Markdown', async () => {
    writeFileSync(first.notePath, '人工编辑的笔记，不能覆盖');
    await page.getByRole('button', { name: '保存来源', exact: true }).click();
    await page.getByText('来源已保存，已创建独立版本。', { exact: true }).waitFor();
    const library = await state(); assert.equal(library.revisions.length, 2);
    assert.equal(readFileSync(first.notePath, 'utf8'), '人工编辑的笔记，不能覆盖');
    await page.getByText('已外部修改', { exact: true }).waitFor();
    await page.screenshot({ path: join(base, 'storage-versions.png') });
  });
  await t.test('restart can reopen archived source even after the original file is removed', async () => {
    await stop(); rmSync(input); await start();
    await page.getByRole('button', { name: /^打开归档/ }).first().click();
    await page.getByRole('heading', { name: '来源 UTF16.txt', exact: true }).waitFor();
    await page.getByRole('button', { name: '原始文本', exact: true }).click();
    assert.equal(await page.getByTestId('raw-source').textContent(), '原文必须完整保留\r\n\r\n第二段');
  });
  await t.test('a failed save is offered after restart and can be resumed into another directory', async () => {
    await stop();
    const failing = new StorageService(join(profile, 'storage'), { checkpoint: stage => { if (stage === 'after-source') throw Object.assign(new Error('synthetic full disk'), { code: 'ENOSPC' }); } });
    await assert.rejects(failing.save({ document: parseSource(raw, input), bytes: raw }, '# 恢复草稿\n\n恢复后的合成正文', { kind: 'generated-note' }));
    await start(); await page.getByRole('button', { name: /^重试保存/ }).waitFor();
    const other = join(own, '恢复位置'); mkdirSync(other); await picker(other);
    await page.getByRole('button', { name: '更改目录', exact: true }).click();
    await page.getByRole('button', { name: /^重试保存/ }).click();
    await page.getByText('保存重试完成。', { exact: true }).waitFor();
    const library = await state(); assert.equal(library.drafts.length, 0); assert.equal(library.revisions.length, 1);
    assert.equal(readFileSync(library.revisions[0].notePath, 'utf8'), '# 恢复草稿\n\n恢复后的合成正文');
    assert.equal(readFileSync(first.notePath, 'utf8'), '人工编辑的笔记，不能覆盖');
  });
  await t.test('renderer cannot supply output paths or escape through revision IDs', async () => {
    for (const [method, args] of [['chooseLibrary', ['D:/private']], ['saveSource', ['../private']], ['openRevision', ['a'.repeat(64), '../note']]]) {
      const result = await page.evaluate(async ([name, values]) => window.clipnote[name](...values), [method, args]); assert.equal(result.status, 'error');
    }
    assert.equal((await state()).revisions.length, 1);
  });
  await t.test('a library refresh transport failure is visible and never becomes an unhandled rejection', async () => {
    const library = await state(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await picker(library.directory);
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('storage:state'); ipcMain.handle('storage:state', () => { throw new Error('synthetic refresh transport failure'); }); });
    await page.getByRole('button', { name: '更改目录', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '归档列表刷新失败' }).waitFor();
    await page.getByRole('button', { name: '导入文件', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  });
});
