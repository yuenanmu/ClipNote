import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { NoteCatalog } from '../../src/modules/reader/catalog.ts';

async function fixture(t: any) {
  const base = resolve('../.local/test-artifacts'); await mkdir(base, { recursive: true });
  const own = await mkdtemp(join(base, 'notes-'));
  t.after(async () => { assert.equal(dirname(own), base); await rm(own, { recursive: true, force: true }); });
  const path = join(own, '中文 笔记.md'); await writeFile(path, '# 保留原文件');
  return { own, path, state: join(own, 'state') };
}
test('registered Markdown persists across service recreation and duplicate additions share one entry', async t => {
  const { path, state } = await fixture(t), catalog = new NoteCatalog(state);
  const added = await catalog.add(path); await catalog.add(path);
  const entries = await new NoteCatalog(state).list();
  assert.equal(entries.length, 1); assert.equal(entries[0].noteId, added.noteId); assert.equal(entries[0].filePath, path); assert.equal(entries[0].available, true);
});
test('removing a registration preserves original bytes and rejects unknown identifiers', async t => {
  const { path, state } = await fixture(t), catalog = new NoteCatalog(state);
  const added = await catalog.add(path); await catalog.remove(added.noteId);
  assert.deepEqual(await catalog.list(), []); assert.equal(await readFile(path, 'utf8'), '# 保留原文件');
  await assert.rejects(catalog.target(added.noteId));
});
test('missing files stay registered and can be relinked without duplicating or copying files', async t => {
  const { path, state, own } = await fixture(t), catalog = new NoteCatalog(state);
  const added = await catalog.add(path); await unlink(path);
  assert.equal((await catalog.list())[0].available, false);
  const moved = join(own, '新位置.md'); await writeFile(moved, '# 移动后');
  await catalog.relink(added.noteId, moved);
  assert.equal((await catalog.list())[0].noteId, added.noteId); assert.deepEqual(await catalog.target(added.noteId), { kind: 'file', path: moved });
  const other = join(own, '另一份.md'); await writeFile(other, '另一份'); await catalog.add(other);
  await assert.rejects(catalog.relink(added.noteId, other));
  assert.equal((await catalog.list()).length, 2);
});
test('a damaged catalog fails without overwriting registrations', async t => {
  const { state } = await fixture(t); await mkdir(state);
  const file = join(state, 'notes.json'); await writeFile(file, '{broken');
  await assert.rejects(new NoteCatalog(state).list()); assert.equal(await readFile(file, 'utf8'), '{broken');
});
