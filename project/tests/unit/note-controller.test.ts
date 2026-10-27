import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createReaderHandlers } from '../../src/main/reader-controller.ts';
import { NoteCatalog } from '../../src/modules/reader/catalog.ts';
import { loadReader } from '../../src/modules/reader/load.ts';
test('note IPC only registers picked or already imported MD, validates IDs and reopens after session eviction', async t => {
  const base = resolve('../.local/test-artifacts'); await mkdir(base, { recursive: true }); const own = await mkdtemp(join(base, 'note-ipc-'));
  t.after(async () => { assert.equal(dirname(own), base); await rm(own, { recursive: true, force: true }); });
  const path = join(own, 'picked.md'); await writeFile(path, '# 正文'); const catalog = new NoteCatalog(join(own, 'state'));
  let picked: string | undefined = path;
  const handlers = createReaderHandlers({ isTrustedSender: event => event === 'trusted', chooseFile: async () => picked, catalog, sourcePath: id => id === 'a'.repeat(64) ? path : undefined, load: target => loadReader(target, own), openFile: async () => '', openLink: async () => {} });
  assert.equal(typeof (handlers as any).noteAdd, 'function', 'persistent note operations must be exposed');
  for (const [action, args] of [['noteList',[]],['noteAdd',[]],['noteOpen',['../private.md']],['noteRemove',['../private.md']],['noteRelink',['../private.md']],['noteSource',['x']]] as const) {
    assert.equal((await (handlers as any)[action]('other', ...args)).status, 'error');
    assert.equal((await (handlers as any)[action]('trusted', ...args, 'extra')).status, 'error');
  }
  assert.deepEqual(await catalog.list(), []);
  const added = await (handlers as any).noteAdd('trusted'); assert.equal(added.status, 'ok'); assert.ok(added.value.noteId);
  for (let index = 0; index < 6; index++) await handlers.open('trusted');
  const reopened = await (handlers as any).noteOpen('trusted', added.value.noteId); assert.equal(reopened.status, 'ok');
  const refreshed = await handlers.refresh('trusted', reopened.value.readerId); assert.equal(refreshed.status, 'ok'); if (refreshed.status === 'ok') assert.equal(refreshed.value.noteId, added.value.noteId);
  assert.equal((await (handlers as any).noteSource('trusted', 'b'.repeat(64))).status, 'error');
  assert.equal((await (handlers as any).noteSource('trusted', 'a'.repeat(64))).value.noteId, added.value.noteId);
  picked = undefined; assert.equal((await (handlers as any).noteRelink('trusted', added.value.noteId)).status, 'cancelled');
  assert.equal((await catalog.list()).length, 1);
});
