import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiConfigStore } from '../../src/modules/api/config.ts';
import { createApiHandlers } from '../../src/main/api-controller.ts';
const secret = 'synthetic-api-key';
const config = { baseUrl: 'https://example.invalid/v1', model: 'synthetic-model', contextWindow: 8192, maxTokens: 2048, apiKey: secret };
const protector = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s.split('').reverse().join('')), decryptString: (b: Buffer) => b.toString().split('').reverse().join('') };
async function fixture(t: test.TestContext) { const base = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url)); await mkdir(base, { recursive: true }); const own = await mkdtemp(join(base, 'api-config-')); t.after(async () => { assert.equal(resolve(dirname(own)), resolve(base)); await rm(own, { recursive: true, force: true }); }); return own; }
const isCode = (code: string) => (error: any) => error?.code === code;

test('configuration persists encrypted key across restarts but never returns plaintext to the UI', async t => {
  const dir = await fixture(t); const first = new ApiConfigStore(dir, protector); assert.deepEqual(await first.state(), { configured: false });
  const state = await first.save(config); assert.deepEqual(state, { configured: true, baseUrl: config.baseUrl, model: config.model, contextWindow: 8192, maxTokens: 2048 });
  assert.equal(JSON.stringify(state).includes(secret), false); assert.equal((await readFile(join(dir, 'api.json'), 'utf8')).includes(secret), false);
  const second = new ApiConfigStore(dir, protector); assert.deepEqual(await second.state(), state); assert.equal((await second.credentials()).apiKey, secret);
  const changed = await second.save({ ...config, model: 'changed-model', apiKey: '' }); assert.ok(changed.configured); assert.equal(changed.model, 'changed-model'); assert.equal((await second.credentials()).apiKey, secret);
  await assert.rejects(second.save({ ...config, baseUrl: 'https://different.invalid/v1', apiKey: '' }), isCode('KEY_REQUIRED'));
  const preserved = await second.state(); assert.ok(preserved.configured); assert.equal(preserved.baseUrl, config.baseUrl);
});
test('unsafe endpoints, credentials in URLs, invalid budgets and unavailable encryption fail safely', async t => {
  const dir = await fixture(t); const store = new ApiConfigStore(dir, protector);
  for (const patch of [{ baseUrl: 'http://example.invalid/v1' }, { baseUrl: 'https://u:p@example.invalid/v1' }, { baseUrl: 'https://example.invalid/v1?key=secret' }, { model: '' }, { contextWindow: 100 }, { maxTokens: 9000 }, { apiKey: '' }]) await assert.rejects(store.save({ ...config, ...patch }));
  await assert.rejects(new ApiConfigStore(dir, { ...protector, isEncryptionAvailable: () => false }).save(config), isCode('ENCRYPTION_UNAVAILABLE'));
  assert.equal((await store.save({ ...config, baseUrl: 'http://127.0.0.1:9876/v1' })).configured, true);
});
test('damaged configuration never exposes secrets or overwrites the existing file', async t => {
  const dir = await fixture(t); await writeFile(join(dir, 'api.json'), '{damaged'); const store = new ApiConfigStore(dir, protector);
  await assert.rejects(store.state(), isCode('CONFIG_DAMAGED')); await assert.rejects(store.save(config), isCode('CONFIG_DAMAGED'));
  assert.equal(await readFile(join(dir, 'api.json'), 'utf8'), '{damaged');
});
test('API IPC requires trusted caller, validates argument count, and only returns sanitized results', async () => {
  let invoked = 0; const handlers = createApiHandlers({ isTrustedSender: (e: any) => e === 'trusted', store: { state: async () => ({ configured: false }), save: async () => { invoked++; throw new Error(secret); } }, test: async () => { invoked++; throw new Error(secret); } });
  assert.equal((await handlers.state('other')).status, 'error'); assert.equal((await handlers.state('trusted', 1)).status, 'error');
  assert.equal((await handlers.test('trusted', 'unexpected')).status, 'error'); assert.equal(invoked, 0);
  const result = await handlers.save('trusted', config); assert.equal(result.status, 'error'); assert.ok(!JSON.stringify(result).includes(secret));
});
