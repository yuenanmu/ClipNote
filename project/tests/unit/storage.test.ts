import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm, rename, symlink, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StorageService } from '../../src/modules/storage/service.ts';
import { parseSource } from '../../src/modules/source/parser.ts';
import { importSourceSnapshot } from '../../src/modules/source/import-file.ts';
import type { RevisionMetadata } from '../../src/contracts/storage.ts';

const metadata: RevisionMetadata = { kind: 'generated-note', model: 'synthetic', promptVersion: 'fixture-v1' };
const errorIs = (code: string) => (error: unknown) => (error as { code?: string }).code === code;
const sourceBytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('原始内容\r\n\r\n第二段', 'utf16le')]);
const snapshot = () => ({ document: parseSource(sourceBytes, 'D:/合成 资料/来源.txt'), bytes: Uint8Array.from(sourceBytes) });
async function fixture(t: test.TestContext) {
  const base = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url));
  await mkdir(base, { recursive: true });
  const own = await mkdtemp(join(base, 'storage-'));
  t.after(async () => { assert.equal(resolve(dirname(own)), resolve(base)); await rm(own, { recursive: true, force: true }); });
  const state = join(own, 'state'), output = join(own, '中文 保存位置');
  await mkdir(output);
  return { own, state, output, store: new StorageService(state) };
}

test('an imported snapshot keeps original bytes after the original file changes', async t => {
  const f = await fixture(t); const file = join(f.own, '原文件.txt');
  await writeFile(file, sourceBytes);
  const first = await importSourceSnapshot(file);
  await writeFile(file, '后来修改的文件');
  assert.deepEqual(Buffer.from(first.bytes), sourceBytes);
  assert.equal(first.document.rawText, '原始内容\r\n\r\n第二段');
});
test('saves exact original bytes, Markdown and portable metadata in a committed revision', async t => {
  const f = await fixture(t); const library = await f.store.chooseDirectory(f.output);
  assert.ok(library.directory!.startsWith(f.output));
  const saved = await f.store.save(snapshot(), '# 合成笔记\n\n合成正文', metadata);
  assert.equal(await readFile(saved.notePath, 'utf8'), '# 合成笔记\n\n合成正文');
  assert.deepEqual(await readFile(saved.sourcePath), sourceBytes);
  const manifest = JSON.parse(await readFile(saved.manifestPath, 'utf8'));
  assert.equal(manifest.files.note, 'note.md');
  assert.equal(manifest.files.source, 'source.txt');
  assert.equal(manifest.metadata.model, 'synthetic');
  const state = await new StorageService(f.state).state();
  assert.equal(state.revisions.length, 1); assert.equal(state.drafts.length, 0);
  const opened = await f.store.open(saved.sourceId, saved.revisionId);
  assert.equal(opened.snapshot.document.sourceId, snapshot().document.sourceId);
  assert.deepEqual(Buffer.from(opened.snapshot.bytes), sourceBytes);
});
test('new versions never overwrite an externally edited note', async t => {
  const f = await fixture(t); await f.store.chooseDirectory(f.output);
  const first = await f.store.save(snapshot(), '第一版', metadata);
  await writeFile(first.notePath, '人工编辑，必须保留');
  const next = await f.store.save(snapshot(), '第二版', metadata);
  assert.notEqual(next.revisionId, first.revisionId);
  assert.equal(await readFile(first.notePath, 'utf8'), '人工编辑，必须保留');
  const list = await f.store.state(); assert.equal(list.revisions.length, 2);
  assert.equal(list.revisions.find(item => item.revisionId === first.revisionId)!.noteModified, true);
});
test('a revision ID collision preserves the existing version and leaves a retryable draft', async t => {
  const f = await fixture(t); await f.store.chooseDirectory(f.output);
  const first = await f.store.save(snapshot(), '已保存的版本', metadata);
  const pendingId = '12345678-1234-1234-1234-123456789abc';
  const ids = [pendingId, first.revisionId];
  const collision = new StorageService(f.state, { id: () => ids.shift()! });
  await assert.rejects(collision.save(snapshot(), '碰撞后待重试的正文', metadata), errorIs('COLLISION'));
  assert.equal(await readFile(first.notePath, 'utf8'), '已保存的版本');
  assert.equal((await f.store.state()).drafts[0].draftId, pendingId);
  const next = await f.store.resume(pendingId);
  assert.notEqual(next.revisionId, first.revisionId);
  assert.equal(await readFile(next.notePath, 'utf8'), '碰撞后待重试的正文');
});
for (const [faultCode, expected] of [['ENOSPC', 'STORAGE_FULL'], ['EACCES', 'STORAGE_DENIED'], ['EROFS', 'STORAGE_DENIED']]) test(`an injected ${faultCode} preserves a restartable draft and allows saving to another directory`, async t => {
  const f = await fixture(t); await f.store.chooseDirectory(f.output);
  const failing = new StorageService(f.state, { checkpoint: stage => { if (stage === 'after-source') throw Object.assign(new Error('synthetic filesystem failure'), { code: faultCode }); } });
  await assert.rejects(failing.save(snapshot(), '重试时必须保留的完整正文', metadata), errorIs(expected));
  const fresh = new StorageService(f.state); const before = await fresh.state();
  assert.equal(before.revisions.length, 0); assert.equal(before.drafts.length, 1);
  const other = join(f.own, '其他位置'); await mkdir(other); await fresh.chooseDirectory(other);
  const saved = await fresh.resume(before.drafts[0].draftId);
  assert.equal(await readFile(saved.notePath, 'utf8'), '重试时必须保留的完整正文');
  assert.deepEqual(await readFile(saved.sourcePath), sourceBytes);
  assert.equal((await fresh.state()).drafts.length, 0);
});
test('interruption before publish stays out of the success list and resumes after restart', async t => {
  const f = await fixture(t); await f.store.chooseDirectory(f.output);
  const failing = new StorageService(f.state, { checkpoint: stage => { if (stage === 'before-commit') throw new Error('synthetic interruption'); } });
  await assert.rejects(failing.save(snapshot(), '尚未发布', metadata), errorIs('SAVE_FAILED'));
  const fresh = new StorageService(f.state), state = await fresh.state();
  assert.equal(state.revisions.length, 0); assert.equal(state.drafts.length, 1);
  await fresh.resume(state.drafts[0].draftId);
  assert.equal((await fresh.state()).revisions.length, 1);
});
test('interruption after publish confirms the previous commit instead of duplicating it', async t => {
  const f = await fixture(t); await f.store.chooseDirectory(f.output);
  const failing = new StorageService(f.state, { checkpoint: stage => { if (stage === 'after-commit') throw new Error('synthetic lost acknowledgement'); } });
  await assert.rejects(failing.save(snapshot(), '已发布但未确认', metadata), errorIs('SAVE_FAILED'));
  const fresh = new StorageService(f.state); const before = await fresh.state();
  assert.equal(before.revisions.length, 1); assert.equal(before.drafts.length, 1);
  const recovered = await fresh.resume(before.drafts[0].draftId);
  assert.equal(recovered.revisionId, before.revisions[0].revisionId);
  assert.equal((await fresh.state()).revisions.length, 1);
});
test('completed draft tombstones cannot hide pending recovery work behind the scan limit', async t => {
  const f = await fixture(t); await f.store.chooseDirectory(f.output);
  const pendingId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const failing = new StorageService(f.state, { id: () => pendingId, checkpoint: stage => { if (stage === 'before-commit') throw new Error('synthetic interruption'); } });
  await assert.rejects(failing.save(snapshot(), '必须能恢复', metadata));
  const drafts = join(f.state, 'drafts');
  for (let start = 0; start < 1000; start += 50) await Promise.all(Array.from({ length: 50 }, async (_, offset) => {
    const id = `00000000-0000-0000-0000-${(start + offset).toString(16).padStart(12, '0')}`;
    const done = join(drafts, id); await mkdir(done); await writeFile(join(done, '.done'), '');
  }));
  const fresh = new StorageService(f.state), state = await fresh.state();
  assert.deepEqual(state.drafts.map(item => item.draftId), [pendingId]);
  const restored = await fresh.resume(pendingId); assert.equal(await readFile(restored.notePath, 'utf8'), '必须能恢复');
});
test('a moved library reopens from relative files without the original source path', async t => {
  const f = await fixture(t); const state = await f.store.chooseDirectory(f.output);
  const saved = await f.store.save(snapshot(), '可迁移版本', metadata);
  const moved = join(f.own, '移动后的库'); await rename(state.directory!, moved);
  const fresh = new StorageService(join(f.own, 'fresh-state')); await fresh.chooseDirectory(moved);
  const opened = await fresh.open(saved.sourceId, saved.revisionId);
  assert.equal(opened.snapshot.document.rawText, '原始内容\r\n\r\n第二段');
  assert.ok(opened.revision.notePath.startsWith(moved));
});
test('unknown directories, path traversal and credential-shaped metadata are refused', async t => {
  const f = await fixture(t); const unknown = join(f.output, 'ClipNote'); await mkdir(unknown);
  await writeFile(join(unknown, '用户资料.txt'), '不可触碰');
  await assert.rejects(f.store.chooseDirectory(f.output), errorIs('UNOWNED_DIRECTORY'));
  assert.equal(await readFile(join(unknown, '用户资料.txt'), 'utf8'), '不可触碰');
  const other = join(f.own, '安全位置'); await mkdir(other); await f.store.chooseDirectory(other);
  await assert.rejects(f.store.open('..', '../note'), errorIs('INVALID_REQUEST'));
  await assert.rejects(f.store.save(snapshot(), '正文', { ...metadata, apiKey: 'synthetic-secret' } as RevisionMetadata), errorIs('INVALID_REQUEST'));
  assert.equal((await f.store.state()).drafts.length, 0);
});
test('corrupt or path-changing manifests never become successfully opened revisions', async t => {
  const f = await fixture(t); await f.store.chooseDirectory(f.output);
  const saved = await f.store.save(snapshot(), '正文', metadata);
  const data = JSON.parse(await readFile(saved.manifestPath, 'utf8')); data.files.source = '../../other.txt';
  await writeFile(saved.manifestPath, JSON.stringify(data));
  await assert.rejects(f.store.open(saved.sourceId, saved.revisionId), errorIs('DAMAGED_DATA'));
  assert.equal((await f.store.state()).revisions.length, 0);
  assert.ok((await f.store.state()).warnings.length);
});
test('a junction in managed output cannot redirect writes outside the library', async t => {
  const f = await fixture(t); const state = await f.store.chooseDirectory(f.output);
  const outside = join(f.own, '其他资料'); await mkdir(outside);
  assert.equal(dirname(resolve(state.directory!)), resolve(f.output));
  const items = join(state.directory!, 'items'); await rm(items, { recursive: true });
  await symlink(outside, items, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.store.save(snapshot(), '不可写到链接外', metadata), errorIs('UNSAFE_PATH'));
  assert.deepEqual(await readdir(outside), []);
});
