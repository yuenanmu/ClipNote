import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageHandlers } from '../../src/main/storage-controller.ts';
import { StorageError } from '../../src/modules/storage/errors.ts';
const trusted = { trusted: true }, sourceId = 'a'.repeat(64), uuid = '12345678-1234-1234-1234-123456789abc';
test('storage IPC rejects untrusted frames and caller paths before invoking file capabilities', async () => {
  let calls = 0;
  const handlers = createStorageHandlers({ isTrustedSender: event => event === trusted, chooseDirectory: async () => { calls++; return 'selected'; }, execute: async () => { calls++; return {}; } });
  for (const action of ['state', 'choose', 'save', 'resume', 'open'] as const) assert.equal((await handlers[action]({})).status, 'error');
  for (const [action, args] of [['state', ['D:/private']], ['choose', ['D:/private']], ['save', ['../file']], ['resume', ['../draft']], ['open', [sourceId, '../file']]] as const) assert.equal((await handlers[action](trusted, ...args)).status, 'error');
  assert.equal(calls, 0);
});
test('directory cancellation preserves the current library without invoking storage', async () => {
  let calls = 0;
  const handlers = createStorageHandlers({ isTrustedSender: () => true, chooseDirectory: async () => undefined, execute: async () => { calls++; } });
  assert.deepEqual(await handlers.choose(trusted), { status: 'cancelled' }); assert.equal(calls, 0);
});
test('valid storage requests forward only known IDs or the system-selected directory', async () => {
  const calls: unknown[] = [];
  const handlers = createStorageHandlers({ isTrustedSender: () => true, chooseDirectory: async () => 'D:/selected', execute: async (action, args) => { calls.push([action, args]); return action; } });
  assert.equal((await handlers.choose(trusted)).status, 'ok');
  await handlers.save(trusted, sourceId); await handlers.resume(trusted, uuid); await handlers.open(trusted, sourceId, uuid);
  assert.deepEqual(calls, [['choose', ['D:/selected']], ['save', [sourceId]], ['resume', [uuid]], ['open', [sourceId, uuid]]]);
});
test('storage failures preserve safe draft IDs but never leak raw filesystem errors', async () => {
  const handlers = createStorageHandlers({ isTrustedSender: () => true, chooseDirectory: async () => 'selected', execute: async () => { throw new StorageError('STORAGE_FULL', uuid); } });
  const result = await handlers.save(trusted, sourceId);
  assert.equal(result.status, 'error'); if (result.status === 'error') { assert.equal(result.error.draftId, uuid); assert.equal(result.error.code, 'STORAGE_FULL'); }
  const raw = createStorageHandlers({ isTrustedSender: () => true, chooseDirectory: async () => 'selected', execute: async () => { throw new Error('private file contents and secret'); } });
  assert.equal(JSON.stringify(await raw.save(trusted, sourceId)).includes('private file contents'), false);
});
test('concurrent storage operations do not open extra dialogs and release busy state', async () => {
  let release!: (value: unknown) => void;
  const handlers = createStorageHandlers({ isTrustedSender: () => true, chooseDirectory: async () => 'selected', execute: () => new Promise(resolve => { release = resolve; }) });
  const first = handlers.save(trusted, sourceId);
  const second = await handlers.choose(trusted); assert.equal(second.status, 'error'); if (second.status === 'error') assert.equal(second.error.code, 'STORAGE_BUSY');
  release({}); assert.equal((await first).status, 'ok');
});
