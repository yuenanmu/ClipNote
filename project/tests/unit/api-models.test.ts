import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { listModels, resolveModelKey } from '../../src/modules/api/models.ts';
import { ApiError } from '../../src/modules/api/errors.ts';
async function server(t: test.TestContext, handler: Parameters<typeof createServer>[1]) { const s = createServer(handler); await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise<void>(resolve => { s.closeAllConnections(); s.close(() => resolve()); })); return `http://127.0.0.1:${(s.address() as any).port}/v1`; }
test('model discovery explicitly GETs the selected endpoint, uses its key and only returns safe identifiers', async t => {
  let auth = '', path = ''; const base = await server(t, (req, res) => { auth = req.headers.authorization ?? ''; path = req.url ?? ''; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }, { id: 'bad\nname' }, { private: 'secret' }] })); });
  assert.deepEqual(await listModels(base, 'synthetic-secret'), ['model-a','model-b']); assert.equal(path, '/v1/models'); assert.equal(auth, 'Bearer synthetic-secret');
});
test('model discovery does not follow redirects and categorizes errors without leaking bodies', async t => {
  for (const [status, code] of [[401,'AUTH_FAILED'],[402,'BALANCE'],[422,'INVALID_CONFIG'],[429,'RATE_LIMIT']] as const) { const base = await server(t, (_req,res) => { res.writeHead(status); res.end('synthetic-secret'); }); await assert.rejects(listModels(base, 'synthetic-secret'), (e: unknown) => e instanceof ApiError && e.code === code && !e.message.includes('synthetic-secret')); }
  let leaked = false; const target = await server(t, (_req,res) => { leaked=true; res.end(); }); const origin = await server(t, (_req,res) => { res.writeHead(307,{location:target}); res.end(); }); await assert.rejects(listModels(origin,'synthetic-secret')); assert.equal(leaked,false);
});
test('saved key is used only for its saved endpoint, while a new endpoint requires an explicit new key', async () => {
  let reads = 0; const store = { state: async () => ({ configured: true as const, baseUrl: 'https://first.invalid/v1', model: 'model', contextWindow: 8192, maxTokens: 2048 }), credentials: async () => { reads++; return { baseUrl: 'https://first.invalid/v1', apiKey: 'saved-key' }; } };
  assert.equal(await resolveModelKey(store, 'https://first.invalid/v1/', ''), 'saved-key');
  await assert.rejects(resolveModelKey(store, 'https://second.invalid/v1', ''), (e: unknown) => e instanceof ApiError && e.code === 'KEY_REQUIRED'); assert.equal(reads, 1);
  assert.equal(await resolveModelKey(store, 'https://second.invalid/v1', 'new-key'), 'new-key'); assert.equal(reads, 1);
});
test('invalid or oversized model lists fail safely, and cancellation stops the request', async t => {
  const malformed = await server(t, (_req, res) => res.end('{broken'));
  await assert.rejects(listModels(malformed, 'key'), (e: unknown) => e instanceof ApiError && e.code === 'INVALID_RESPONSE');
  const large = await server(t, (_req, res) => res.end(JSON.stringify({ data: [{ id: 'x'.repeat(2 * 1024 * 1024) }] })));
  await assert.rejects(listModels(large, 'key'), (e: unknown) => e instanceof ApiError && e.code === 'INVALID_RESPONSE');
  const controller = new AbortController(); controller.abort(); await assert.rejects(listModels(malformed, 'key', controller.signal), (e: unknown) => e instanceof ApiError && e.code === 'CANCELLED');
});
