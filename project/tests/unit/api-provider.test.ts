import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import { createApiAdapter, analyzeWithApi } from '../../src/modules/api/provider.ts';
import { parseSource } from '../../src/modules/source/parser.ts';
import { analyzeSource } from '../../src/modules/analysis/run.ts';
import type { ApiConfigInput } from '../../src/contracts/api.ts';
const source = parseSource(Buffer.from('合成原文'), '合成.txt');
const profile = { provider: 'api', model: 'synthetic-model', promptVersion: 't06-v1', inputCharBudget: 2000, outputCharBudget: 64000, overlapChars: 80 };
const secret = 'synthetic-secret-value';
async function server(t: test.TestContext, handler: RequestListener) { const s = createServer(handler); await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise<void>(resolve => { s.closeAllConnections(); s.close(() => resolve()); })); return `http://127.0.0.1:${(s.address() as any).port}/v1`; }
const credentials = (baseUrl: string): ApiConfigInput => ({ baseUrl, apiKey: secret, model: profile.model, contextWindow: 8192, maxTokens: 2048 });
function send(response: any, text: string, finish = 'stop') { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: profile.model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`); response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: profile.model, choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`); response.end('data: [DONE]\n\n'); }
const valid = () => { const ref = { segmentId: source.segments[0].segmentId, startOffset: 0, endOffset: source.segments[0].text.length }; return JSON.stringify({ title: '笔记', sections: [{ heading: '章节', refs: [ref], items: [{ kind: 'point', text: '要点', refs: [ref], children: [] }] }] }); };

test('pi-ai sends one configured request and the result passes actual T06 validation', async t => {
  let count = 0, received: any; const base = await server(t, async (req, res) => { count++; const chunks = []; for await (const chunk of req) chunks.push(chunk); received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) }; send(res, valid()); });
  const result = await analyzeSource(source, profile, createApiAdapter(credentials(base)));
  assert.equal(count, 1); assert.equal(received.url, '/v1/chat/completions'); assert.equal(received.auth, `Bearer ${secret}`); assert.equal(received.body.model, profile.model); assert.ok(JSON.stringify(received.body).includes('合成原文')); assert.ok(result.markdown.includes('要点')); assert.ok(!JSON.stringify(result).includes(secret));
});
test('HTTP errors map to sanitized categories without retry or response body leakage', async t => {
  for (const [status, expected] of [[400,'INVALID_CONFIG'], [404,'INVALID_CONFIG'], [401,'AUTH_FAILED'], [403,'PERMISSION_DENIED'], [429,'QUOTA'], [500,'NETWORK']] as const) {
    let count = 0; const base = await server(t, (_req,res) => { count++; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: secret } })); });
    const adapter = createApiAdapter(credentials(base)); const req = { chunk: { chunkId: 'test', index: 0, core: [], context: [], request: '合成' }, profile, repair: false };
    await assert.rejects(adapter(req), (error: any) => { assert.equal(error.code, expected); assert.ok(!String(error).includes(secret)); return true; }); assert.equal(count, 1);
  }
});
test('oversized streaming responses are stopped before unbounded text can accumulate', async t => {
  let closedEarly = false; let finished: () => void = () => {}; const closed = new Promise<void>(resolve => { finished = resolve; });
  const base = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.on('close', () => { closedEarly = !res.writableFinished; finished(); }); const chunk = `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: profile.model, choices: [{ index: 0, delta: { content: 'a'.repeat(200) }, finish_reason: null }] })}\n\n`; let count = 0; const write = () => { while (count++ < 25000 && !res.destroyed) { if (!res.write(chunk)) { res.once('drain', write); return; } } if (!res.destroyed) res.end('data: [DONE]\n\n'); }; write(); });
  const req = { chunk: { chunkId: 'test', index: 0, core: [], context: [], request: '合成' }, profile, repair: false };
  await assert.rejects(createApiAdapter(credentials(base))(req), (error: any) => error.code === 'INVALID_RESPONSE'); await closed; assert.equal(closedEarly, true);
});
test('truncated responses and cancellation do not become successful model results', async t => {
  const base = await server(t, (_req,res) => send(res, valid(), 'length')); const adapter = createApiAdapter(credentials(base));
  const req = { chunk: { chunkId: 'test', index: 0, core: [], context: [], request: '合成' }, profile, repair: false };
  assert.equal((await adapter(req)).status, 'truncated');
  const controller = new AbortController(); controller.abort(); await assert.rejects(adapter({ ...req, signal: controller.signal }), (e: any) => e.code === 'CANCELLED');
});
test('redirects never forward credentials or source to another server', async t => {
  let leaked = 0; const destination = await server(t, (_req,res) => { leaked++; res.end(); }); const base = await server(t, (_req,res) => { res.writeHead(307, { location: `${destination}/chat/completions` }); res.end(); });
  await assert.rejects(createApiAdapter(credentials(base))({ chunk: { chunkId: 'test', index: 0, core: [], context: [], request: '合成' }, profile, repair: false })); assert.equal(leaked, 0);
});
test('API analysis exposes sanitized service categories and binds reusable checkpoints to the service address', async t => {
  const good = await server(t, (_req, res) => send(res, valid())); const first = await analyzeWithApi(source, credentials(good));
  const bad = await server(t, (_req, res) => { res.writeHead(401); res.end(secret); });
  await assert.rejects(analyzeWithApi(source, credentials(bad)), (e: any) => e.code === 'AUTH_FAILED' && !JSON.stringify(e).includes(secret));
  await assert.rejects(analyzeWithApi(source, credentials(bad), { checkpoints: first.checkpoints }), (e: any) => e.code === 'INVALID_CHECKPOINT');
});
test('a malformed successful response is reported as invalid rather than a network failure', async t => {
  const base = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('not-json'); });
  const req = { chunk: { chunkId: 'test', index: 0, core: [], context: [], request: '合成' }, profile, repair: false };
  await assert.rejects(createApiAdapter(credentials(base))(req), (error: any) => error.code === 'INVALID_RESPONSE');
});
test('conservative input limit reserves protocol space and rejects before sending an oversized prompt', async t => {
  let calls = 0; const base = await server(t, (_req, res) => { calls++; res.end(); });
  const req = { chunk: { chunkId: 'test', index: 0, core: [], context: [], request: 'a'.repeat(1600) }, profile, repair: false };
  await assert.rejects(createApiAdapter({ ...credentials(base), contextWindow: 4096, maxTokens: 2048 })(req), (error: any) => error.code === 'INVALID_CONFIG'); assert.equal(calls, 0);
});
test('minimum supported context still builds a valid chunk profile and can analyze short input', async t => {
  const base = await server(t, (_req, res) => send(res, valid()));
  const result = await analyzeWithApi(source, { ...credentials(base), contextWindow: 4096, maxTokens: 2048 });
  assert.ok(result.markdown.includes('要点'));
});
test('largest supported context stays within planner byte limit', async t => {
  const base = await server(t, (_req, res) => send(res, valid())); const result = await analyzeWithApi(source, { ...credentials(base), contextWindow: 1000000, maxTokens: 32768 }); assert.ok(result.markdown.includes('要点'));
});
test('minimum supported context splits a long Chinese source into requests within the byte budget', async t => {
  const long = parseSource(Buffer.from('中'.repeat(2000)), '合成.txt'); let calls = 0;
  const base = await server(t, async (req, res) => { calls++; const chunks = []; for await (const part of req) chunks.push(part); const body = JSON.parse(Buffer.concat(chunks).toString()); const input = JSON.parse(body.messages.at(-1).content.split('\n')[1]); const refs = input.core.map(({ segmentId, startOffset, endOffset }: any) => ({ segmentId, startOffset, endOffset })); send(res, JSON.stringify({ title: '笔记', sections: [{ heading: '章节', refs, items: [{ kind: 'point', text: '要点', refs, children: [] }] }] })); });
  const result = await analyzeWithApi(long, { ...credentials(base), contextWindow: 4096, maxTokens: 2048 }); assert.ok(calls > 1); assert.equal(result.checkpoints.length, calls);
});
test('a valid response split over thousands of SSE frames remains accepted', async t => {
  const base = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (let i = 0; i < 4000; i++) res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: profile.model, choices: [{ index: 0, delta: { content: 'a' }, finish_reason: null }] })}\n\n`); res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: profile.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`); res.end('data: [DONE]\n\n'); });
  const req = { chunk: { chunkId: 'test', index: 0, core: [], context: [], request: '合成' }, profile, repair: false }; const response = await createApiAdapter(credentials(base))(req); assert.equal(response.status, 'completed'); assert.equal((response.value as string).length, 4000);
});
