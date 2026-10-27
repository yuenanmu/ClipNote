import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import electronPath from 'electron';

test('offline Markdown reader shares anchors, refreshes safely and traces archived sources', { timeout: 100_000 }, async t => {
  const base = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url)); mkdirSync(base, { recursive: true });
  const own = mkdtempSync(join(base, 'reader-ui-')), path = join(own, '中文 阅读.md'), output = join(own, 'output'); mkdirSync(output);
  const markdown = '---\n# 元数据伪标题\n---\n\n# 阅读示例\n\n欢迎阅读 **本地资料**。\n\n### 详细依据\n\n论据与限制。\n\n## 重复标题\n\n正文一。\n\n## 重复标题\n\n正文二。\n\n~~~md\n# 代码伪标题\n~~~\n\n<script>window.readerAttack=1</script>\n\n![远程图片](https://example.invalid/tracker.png)\n\n[外链](https://example.com/reader) [脚本](javascript:alert%281%29) [本地越界](file:///C:/private.txt)\n\n|项目|状态|\n|--|--|\n|阅读|离线|';
  writeFileSync(path, markdown);
  const env = { ...process.env, CLIPNOTE_TEST_USER_DATA: join(own, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: electronPath, args: [fileURLToPath(new URL('../../dist/main/index.cjs', import.meta.url))], env });
  t.after(async () => { await app.close(); assert.equal(resolve(dirname(own)), resolve(base)); rmSync(own, { recursive: true, force: true }); });
  const page = await app.firstWindow(); page.setDefaultTimeout(6000); await app.context().setOffline(true);
  const requests = [], errors = []; page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); }); page.on('pageerror', error => errors.push(error.message));
  const picker = async selected => app.evaluate(({ dialog }, value) => { dialog.showOpenDialog = async () => value ? { canceled: false, filePaths: [value] } : { canceled: true, filePaths: [] }; }, selected);
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await t.test('direct open and cancellation work without AI or source import', async () => {
    await picker(undefined); await page.getByRole('button', { name: '添加 Markdown', exact: true }).click(); await page.getByText('已取消 Markdown 选择', { exact: true }).waitFor();
    await picker(path); await page.getByRole('button', { name: '添加 Markdown', exact: true }).click();
    await page.getByRole('heading', { name: '中文 阅读.md', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Markdown', exact: true }).click();
    assert.equal(await page.getByTestId('reader-body').getByRole('table').count(), 1);
    assert.equal(await page.getByRole('button', { name: '定位标题 元数据伪标题', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '定位标题 代码伪标题', exact: true }).count(), 0);
  });
  await t.test('collapsible outline and duplicate headings locate the matching body anchor', async () => {
    await page.getByRole('button', { name: '收起 阅读示例', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '定位标题 详细依据', exact: true }).count(), 0);
    await page.getByRole('button', { name: '展开 阅读示例', exact: true }).click();
    await page.getByRole('button', { name: '定位标题 重复标题', exact: true }).nth(1).click();
    const target = page.getByTestId('reader-body').locator('[data-reader-anchor="重复标题-2"]');
    assert.equal(await target.getAttribute('tabindex'), '-1'); assert.equal(await target.evaluate(element => element === document.activeElement), true);
    await page.screenshot({ path: join(base, 'markdown-reader.png') });
  });
  await t.test('HTML, images and unsafe links have no executable or automatic network side effects', async () => {
    assert.equal(await page.evaluate(() => window.readerAttack), undefined);
    assert.equal(await page.getByTestId('reader-body').locator('script,img,iframe,svg').count(), 0);
    assert.equal(await page.getByRole('button', { name: '脚本', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '本地越界', exact: true }).isDisabled(), true);
    assert.deepEqual(requests, []);
    await app.evaluate(({ shell }) => { globalThis.readerExternalCalls = []; shell.openExternal = async url => { globalThis.readerExternalCalls.push(url); }; shell.openPath = async path => { globalThis.readerExternalCalls.push(path); return ''; }; });
    await page.getByRole('button', { name: '外链', exact: true }).click();
    await page.getByRole('button', { name: '外部打开', exact: true }).click();
    assert.deepEqual(await app.evaluate(() => globalThis.readerExternalCalls), ['https://example.com/reader', path]);
    assert.equal((await page.evaluate(() => window.clipnote.readerOpen('C:/arbitrary.md'))).status, 'error');
  });
  await t.test('explicit refresh sees external edits and a missing file retains the previous body', async () => {
    writeFileSync(path, '# 外部修改后的标题\n\n保留新正文');
    await page.getByRole('button', { name: '刷新文件', exact: true }).click(); await page.getByRole('button', { name: '定位标题 外部修改后的标题', exact: true }).waitFor();
    unlinkSync(path); await page.getByRole('button', { name: '刷新文件', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '无法读取此 Markdown' }).waitFor(); await page.getByTestId('reader-body').getByText('保留新正文', { exact: true }).waitFor();
    writeFileSync(path, ''); await page.getByRole('button', { name: '刷新文件', exact: true }).click(); await page.getByText('这是一份空 Markdown。', { exact: true }).waitFor();
  });
  await t.test('YAML and TOML frontmatter stay metadata rather than become visible article content', async () => {
    for (const [delimiter, label] of [['---', 'YAML'], ['+++', 'TOML']]) {
      writeFileSync(path, delimiter + '\ntitle = "不应进入正文"\n' + delimiter + '\n\n# ' + label + '正文\n\n可见内容。');
      await page.getByRole('button', { name: '刷新文件', exact: true }).click();
      await page.getByRole('button', { name: '定位标题 ' + label + '正文', exact: true }).waitFor();
      assert.doesNotMatch(await page.getByTestId('reader-body').innerText(), /不应进入正文/);
    }
  });
  await t.test('outline navigation crosses body pages without truncating long documents', async () => {
    writeFileSync(path, '# 开始\n\n' + '段落正文。\n\n'.repeat(230) + '# 跨页目标\n\n完整末尾。');
    await page.getByRole('button', { name: '刷新文件', exact: true }).click(); await page.getByRole('button', { name: '定位标题 跨页目标', exact: true }).click();
    await page.getByTestId('reader-body').getByText('完整末尾。', { exact: true }).waitFor();
    assert.equal(readFileSync(path, 'utf8').endsWith('完整末尾。'), true);
  });
  await t.test('an edited archive note opens with source references after deleting its original file', async () => {
    await page.getByRole('button', { name: '返回文件工作台', exact: true }).click();
    const input = join(own, '来源.srt'); writeFileSync(input, '1\n00:00:01,000 --> 00:00:02,000\n第一条依据\n\n2\n00:00:03,000 --> 00:00:04,000\n第二条依据');
    await picker(input); await page.getByRole('button', { name: '导入文件', exact: true }).click(); await page.getByRole('heading', { name: '来源.srt', exact: true }).waitFor();
    await picker(output); await page.getByRole('button', { name: '选择保存目录', exact: true }).click(); await page.getByRole('button', { name: '保存来源', exact: true }).click(); await page.getByText('来源已保存，已创建独立版本。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '导入文件', exact: true }).waitFor();
    const state = await page.evaluate(() => window.clipnote.libraryState()); assert.equal(state.status, 'ok'); const saved = state.value.revisions[0];
    const opened = await page.evaluate(({ sourceId, revisionId }) => window.clipnote.openRevision(sourceId, revisionId), saved); const segmentId = opened.value.document.segments[1].segmentId;
    writeFileSync(saved.notePath, '# 已编辑的归档\n\n[实际依据](clipnote-source:' + segmentId + ')'); unlinkSync(input);
    await page.getByRole('button', { name: /^阅读笔记 来源.srt/ }).click(); await page.getByRole('button', { name: 'Markdown', exact: true }).click(); await page.getByRole('button', { name: '定位标题 已编辑的归档', exact: true }).waitFor();
    await page.getByText('此笔记已被外部修改，当前显示磁盘内容。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '实际依据', exact: true }).click();
    await page.getByTestId('raw-source').locator('mark').getByText('第二条依据', { exact: true }).waitFor();
    assert.match(await page.getByTestId('source-location').innerText(), /00:03\.000/);
  });
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
});
