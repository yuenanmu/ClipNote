import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, unlink, rm, rmdir, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReader } from '../../src/modules/reader/load.ts';
import { StorageService } from '../../src/modules/storage/service.ts';
import { parseSource } from '../../src/modules/source/parser.ts';
async function fixture(t: test.TestContext) {
  const base = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url)); await mkdir(base, { recursive: true });
  const own = await mkdtemp(join(base, 'reader-')), path = join(own, '中文 资料.md'), state = join(own, 'state');
  t.after(async () => { assert.equal(resolve(dirname(own)), resolve(base)); await rm(own, { recursive: true, force: true }); });
  return { own, path, state };
}
test('direct Markdown supports Chinese paths, UTF-16, blank files and refreshed disk contents', async t => {
  const f = await fixture(t), target = { kind: 'file' as const, path: f.path };
  await writeFile(f.path, Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from('# 中文标题\r\n\r\n正文', 'utf16le')]));
  const first = await loadReader(target, f.state); assert.equal(first.encoding, 'utf-16le'); assert.equal(first.content.headings[0].title, '中文标题');
  await writeFile(f.path, '# 外部新标题'); const refreshed = await loadReader(target, f.state);
  assert.equal(refreshed.content.headings[0].title, '外部新标题'); assert.notEqual(first.checksum, refreshed.checksum);
  await writeFile(f.path, ''); assert.equal((await loadReader(target, f.state)).content.root.children.length, 0);
});
test('missing, oversized, binary and non-Markdown inputs return explicit safe categories', async t => {
  const f = await fixture(t);
  await assert.rejects(loadReader({ kind: 'file', path: f.path }, f.state), { code: 'READER_UNREADABLE' });
  await writeFile(f.path, Buffer.alloc(2 * 1024 * 1024 + 1, 65)); await assert.rejects(loadReader({ kind: 'file', path: f.path }, f.state), { code: 'READER_TOO_LARGE' });
  await writeFile(f.path, Buffer.from([0,1,2])); await assert.rejects(loadReader({ kind: 'file', path: f.path }, f.state), { code: 'READER_ENCODING' });
  await assert.rejects(loadReader({ kind: 'file', path: join(f.own, 'x.exe') }, f.state), { code: 'READER_INVALID_REQUEST' });
});
test('a refreshed path replaced by a junction cannot redirect reading to another directory', async t => {
  const f = await fixture(t), directory = join(f.own, 'selected'), other = join(f.own, 'other'); await mkdir(directory); await mkdir(other);
  const path = join(directory, 'note.md'); await writeFile(path, '# 原文'); await writeFile(join(other, 'note.md'), '# 无关内容');
  await loadReader({ kind: 'file', path }, f.state); await unlink(path); await rmdir(directory);
  await symlink(other, directory, 'junction');
  await assert.rejects(loadReader({ kind: 'file', path }, f.state), { code: 'READER_UNREADABLE' });
});
test('archive reading keeps current external edits and uses an archived source after the original is deleted', async t => {
  const f = await fixture(t), output = join(f.own, 'output'); await mkdir(output);
  const store = new StorageService(f.state); await store.chooseDirectory(output);
  const bytes = Buffer.from('实际来源\n\n第二段'), source = parseSource(bytes, join(f.own, 'already-removed.txt'));
  const saved = await store.save({ document: source, bytes }, '# 初稿', { kind: 'generated-note', sourceRefs: [source.segments[0].segmentId] });
  await writeFile(saved.notePath, '# 人工编辑\n\n[依据](clipnote-source:' + source.segments[0].segmentId + ')');
  const target = { kind: 'revision' as const, sourceId: saved.sourceId, revisionId: saved.revisionId };
  const opened = await loadReader(target, f.state); assert.equal(opened.noteModified, true); assert.equal(opened.content.headings[0].title, '人工编辑');
  assert.deepEqual(opened.archive?.segmentIds, source.segments.map(item => item.segmentId));
  await assert.rejects(loadReader({ ...target, expectedPath: join(f.own, 'different.md') }, f.state), { code: 'READER_UNREADABLE' });
  await unlink(saved.sourcePath); await assert.rejects(loadReader(target, f.state), { code: 'READER_UNREADABLE' });
});
