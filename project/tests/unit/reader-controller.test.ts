import test from 'node:test';
import assert from 'node:assert/strict';
import { createReaderHandlers } from '../../src/main/reader-controller.ts';
import type { ReaderResult } from '../../src/main/reader-controller.ts';
import { ReaderError } from '../../src/modules/reader/errors.ts';
import type { LoadedReader } from '../../src/contracts/reader.ts';
import { parseMarkdown } from '../../src/modules/reader/parse.ts';
const loaded: LoadedReader = { fileName: '资料.md', filePath: 'D:/资料.md', checksum: 'hash', encoding: 'utf-8', content: parseMarkdown('[已知链接](https://example.com/known)') };
const sourceId = 'a'.repeat(64), revisionId = '11111111-1111-1111-1111-111111111111';
const value = (result: ReaderResult<any>) => { assert.equal(result.status, 'ok'); if (result.status !== 'ok') throw new Error('Expected ok'); return result.value; };
const errorCode = (result: ReaderResult<any>) => { assert.equal(result.status, 'error'); if (result.status !== 'error') throw new Error('Expected error'); return result.error.code; };
function setup(options: Record<string, unknown> = {}) {
  const calls: unknown[] = [];
  const handlers = createReaderHandlers({ isTrustedSender: event => event === 'trusted', chooseFile: async () => 'D:/资料.md', load: async target => { calls.push(target); return loaded; }, openFile: async path => { calls.push(path); return ''; }, openLink: async url => { calls.push(url); }, ...options });
  return { handlers, calls };
}
test('reader IPC rejects untrusted frames, arbitrary paths and surplus arguments', async () => {
  const { handlers, calls } = setup();
  for (const [action, args] of [['open',[]],['revision',[sourceId,revisionId]],['refresh',['unknown']],['external',['unknown']],['link',['unknown','https://example.com/known']]] as const) assert.equal((await handlers[action]('other', ...args)).status, 'error');
  for (const [action, args] of [['open',['D:/private.md']],['revision',['../']],['refresh',['../x']],['external',[{},'extra']],['link',['x','file:///x']]] as const) assert.equal((await handlers[action]('trusted', ...args)).status, 'error');
  assert.deepEqual(calls, []);
});
test('cancel does not register a file or read a path', async () => {
  const { handlers, calls } = setup({ chooseFile: async () => undefined });
  assert.equal((await handlers.open('trusted')).status, 'cancelled'); assert.deepEqual(calls, []);
});
test('opening registers an opaque session and refresh uses its path rather than caller input', async () => {
  const { handlers, calls } = setup();
  const first = await handlers.open('trusted'); assert.equal(first.status, 'ok');
  const next = await handlers.refresh('trusted', first.value.readerId);
  assert.equal(value(next).readerId, first.value.readerId);
  assert.deepEqual(calls, [{ kind: 'file', path: 'D:/资料.md' }, { kind: 'file', path: 'D:/资料.md' }]);
});
test('archive refresh pins the validated note path and forwards only known revision IDs', async () => {
  const { handlers, calls } = setup(); const first = await handlers.revision('trusted', sourceId, revisionId);
  assert.equal(first.status, 'ok'); await handlers.refresh('trusted', first.value.readerId);
  assert.deepEqual(calls, [{ kind: 'revision', sourceId, revisionId }, { kind: 'revision', sourceId, revisionId, expectedPath: loaded.filePath }]);
});
test('external actions require an active session and a safe link actually present in its document', async () => {
  const { handlers, calls } = setup(); const first = await handlers.open('trusted'), id = value(first).readerId;
  for (const url of ['https://example.com/unknown','javascript:alert(1)','https://u:p@example.com','file:///x']) assert.equal((await handlers.link('trusted', id, url)).status, 'error');
  assert.equal((await handlers.link('trusted', id, 'https://example.com/known')).status, 'ok');
  assert.equal((await handlers.external('trusted', id)).status, 'ok');
  assert.deepEqual(calls.slice(1), ['https://example.com/known', loaded.filePath]);
});
test('failed refresh keeps the session, errors stay sanitized and concurrent calls stay serial', async () => {
  let fail = false, release!: () => void;
  const { handlers } = setup({ load: async () => { if (fail) throw new Error('private-path-and-secret'); return loaded; } });
  const first = value(await handlers.open('trusted')); fail = true;
  const rejected = await handlers.refresh('trusted', first.readerId); assert.equal(rejected.status, 'error'); assert.doesNotMatch(JSON.stringify(rejected), /private-path-and-secret/);
  fail = false; assert.equal((await handlers.refresh('trusted', first.readerId)).status, 'ok');
  const busy = setup({ chooseFile: () => new Promise(resolve => { release = () => resolve(undefined); }) }).handlers;
  const pending = busy.open('trusted'); assert.equal(errorCode(await busy.open('trusted')), 'READER_BUSY'); release(); await pending;
  const failedOpen = setup({ openFile: async () => 'private error' }).handlers, opened = await failedOpen.open('trusted');
  assert.equal(errorCode(await failedOpen.external('trusted', value(opened).readerId)), new ReaderError('READER_EXTERNAL_FAILED').code);
});
test('bounded sessions expire old IDs rather than retaining arbitrary file capabilities forever', async () => {
  const { handlers } = setup(); const first = await handlers.open('trusted');
  for (let index = 0; index < 5; index++) await handlers.open('trusted');
  assert.equal(errorCode(await handlers.refresh('trusted', value(first).readerId)), 'READER_EXPIRED');
});
