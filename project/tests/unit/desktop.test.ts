import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportHandler } from '../../src/main/import-controller.ts';
import { parseSource } from '../../src/modules/source/parser.ts';
import { SourceImportError } from '../../src/modules/source/errors.ts';

const trusted = { id: 'trusted' };
const doc = parseSource(Buffer.from('合成原文'), 'D:/合成.txt');
test('a cancelled picker returns cancelled without reading a file', async () => {
  let reads = 0;
  const handle = createImportHandler({ isTrustedSender: event => event === trusted, chooseFile: async () => undefined, loadFile: async () => { reads++; return doc; } });
  assert.deepEqual(await handle(trusted), { status: 'cancelled' });
  assert.equal(reads, 0);
});
test('only trusted main-frame requests with no caller-supplied arguments reach the picker', async () => {
  let picks = 0;
  const handle = createImportHandler({ isTrustedSender: event => event === trusted, chooseFile: async () => { picks++; return 'D:/合成.txt'; }, loadFile: async () => doc });
  assert.equal((await handle({})).status, 'error');
  assert.equal((await handle(trusted, 'D:/private.txt')).status, 'error');
  assert.equal(picks, 0);
  const result = await handle(trusted);
  assert.equal(result.status, 'imported');
  if (result.status === 'imported') assert.equal(result.document, doc);
});
test('errors are sanitized and subsequent valid imports recover', async () => {
  let failed = true;
  const handle = createImportHandler({ isTrustedSender: () => true, chooseFile: async () => 'D:/合成.txt', loadFile: async () => { if (failed) throw new Error('private token and system error'); return doc; } });
  const result = await handle(trusted);
  assert.equal(result.status, 'error');
  assert.equal(JSON.stringify(result).includes('private token'), false);
  failed = false;
  assert.equal((await handle(trusted)).status, 'imported');
  const known = createImportHandler({ isTrustedSender: () => true, chooseFile: async () => 'D:/broken.srt', loadFile: async () => { throw new SourceImportError('INVALID_SUBTITLE'); } });
  const knownResult = await known(trusted);
  assert.equal(knownResult.status, 'error');
  if (knownResult.status === 'error') assert.equal(knownResult.error.code, 'INVALID_SUBTITLE');
});
test('concurrent requests do not create multiple pickers and busy state clears', async () => {
  let release!: (path: string) => void;
  const handle = createImportHandler({ isTrustedSender: () => true, chooseFile: () => new Promise(resolve => { release = resolve; }), loadFile: async () => doc });
  const first = handle(trusted);
  const duplicate = await handle(trusted);
  assert.equal(duplicate.status, 'error');
  if (duplicate.status === 'error') assert.equal(duplicate.error.code, 'IMPORT_BUSY');
  release('D:/合成.txt');
  assert.equal((await first).status, 'imported');
});
