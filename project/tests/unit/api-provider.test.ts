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

test('deadline and cancellation settle promptly even when transport ignores abort', async t => {
  // Load the fixed SDK before measuring the request deadline.
  await import('@earendil-works/pi-ai');
  await import('@earendil-works/pi-ai/api/openai-completions.lazy');
  for (const cancelled of [false, true]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 800));
      return new Response('{}', { status: 503 });
    });
    const controller = new AbortController();
    const timer = cancelled ? setTimeout(() => controller.abort(), 40) : undefined;
    const started = performance.now();
    try {
      await assert.rejects(createApiAdapter(credentials('http://127.0.0.1:1/v1'), cancelled ? 2000 : 80)({
        chunk: { chunkId: 'deadline', index: 0, core: [], context: [], request: 'synthetic' },
        profile, repair: false, signal: controller.signal,
      }), (error: any) => error.code === (cancelled ? 'CANCELLED' : 'TIMEOUT'));
      assert.ok(performance.now() - started < 500, 'caller must not wait for an abort-ignoring transport');
      assert.equal(calls, 1);
    } finally { clearTimeout(timer); mock.mock.restore(); }
  }
});

test('pi-ai sends one configured request and the result passes actual T06 validation', async t => {
  let count = 0, received: any; const base = await server(t, async (req, res) => { count++; const chunks = []; for await (const chunk of req) chunks.push(chunk); received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) }; send(res, valid()); });
  const result = await analyzeSource(source, profile, createApiAdapter(credentials(base)));
  assert.equal(count, 1); assert.equal(received.url, '/v1/chat/completions'); assert.equal(received.auth, `Bearer ${secret}`); assert.equal(received.body.model, profile.model); assert.ok(JSON.stringify(received.body).includes('合成原文')); assert.ok(result.markdown.includes('要点')); assert.ok(!JSON.stringify(result).includes(secret));
});
test('short reference identifiers reduce repeated model output while preserving real source links', async t => {
  const tiny = parseSource(Buffer.from('第一段内容。\n\n第二段内容。'), '合成.txt'); let requestCore: any[] = []; let outputLength = 0, oldLength = 0;
  const base = await server(t, async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part); const body = JSON.parse(Buffer.concat(parts).toString());
    requestCore = JSON.parse(body.messages.at(-1).content.split('\n')[1]).core;
    const refs = requestCore.map(({ segmentId, startOffset, endOffset }) => ({ segmentId, startOffset, endOffset }));
    const makeOutput = (items: typeof refs) => JSON.stringify({ title: '笔记', sections: [{ heading: '章节', refs: items, items: [{ kind: 'point', text: '要点', refs: items, children: [] }] }] });
    const output = makeOutput(refs); outputLength = output.length; oldLength = makeOutput(refs.map((ref, i) => ({ ...ref, segmentId: tiny.segments[i].segmentId }))).length; send(res, output);
  });
  const value = await analyzeWithApi(tiny, credentials(base));
  assert.deepEqual(requestCore.map(ref => ref.segmentId), ['s1', 's2']);
  assert.ok(oldLength - outputLength >= 250); assert.deepEqual(value.sourceRefs, tiny.segments.map(item => item.segmentId));
  assert.deepEqual(value.outline.sections[0].refs.map(ref => ref.segmentId), tiny.segments.map(item => item.segmentId));
  assert.ok(!value.markdown.includes('clipnote-source:'));
});
test('unknown compact identifiers still fail reference validation', async t => {
  const base = await server(t, (_req, res) => { const refs = [{ segmentId: 's999', startOffset: 0, endOffset: 1 }]; send(res, JSON.stringify({ title: '笔记', sections: [{ heading: '章节', refs, items: [{ kind: 'point', text: '要点', refs, children: [] }] }] })); });
  await assert.rejects(analyzeWithApi(source, credentials(base)), (error: any) => error.code === 'INVALID_REFERENCE');
});

test('range aliases eliminate output coordinates while retaining exact Unicode source ranges', async t => {
  const input = parseSource(Buffer.from('中文😀内容。\n\n第二段。'), 'ranges.txt');
  let compactLength = 0, legacyLength = 0;
  const base = await server(t, async (req, res) => {
    const bytes = []; for await (const part of req) bytes.push(part);
    const prompt = JSON.parse(Buffer.concat(bytes).toString()).messages.at(-1).content;
    const core = JSON.parse(prompt.split('\n')[1]).core;
    const refs = core.map((ref: any) => ref.refId);
    const output = { title: '笔记', sections: [{ heading: '章节', refs, items: [{ kind: 'point', text: '保留内容', refs, children: [] }] }] };
    compactLength = JSON.stringify(output).length;
    legacyLength = JSON.stringify(output).replaceAll(JSON.stringify(refs), JSON.stringify(core.map(({segmentId,startOffset,endOffset}: any) => ({segmentId,startOffset,endOffset})))).length;
    send(res, JSON.stringify(output));
  });
  const result = await analyzeWithApi(input, credentials(base));
  assert.deepEqual(result.outline.sections[0].refs, input.segments.map(segment => ({ segmentId:segment.segmentId, startOffset:0, endOffset:segment.text.length })));
  assert.ok(compactLength < legacyLength - 100);
});

test('unknown range aliases never gain a valid source reference', async t => {
  const base = await server(t, (_req,res) => send(res, JSON.stringify({title:'笔记',sections:[{heading:'章节',refs:['r999'],items:[{kind:'point',text:'内容',refs:['r999'],children:[]}]}]})));
  await assert.rejects(analyzeWithApi(source,credentials(base)), (error:any) => error.code==='INVALID_REFERENCE');
});
test('analysis reports request count and time without exposing source or credentials', async t => {
  const base = await server(t, (_req, res) => setTimeout(() => send(res, valid()), 40)); let metrics: any;
  await analyzeWithApi(source, credentials(base), { onMetrics: value => { metrics = value; } });
  assert.equal(metrics.requests, 1); assert.ok(metrics.apiMs >= 30); assert.ok(metrics.localMs >= 0); assert.ok(metrics.prepareMs >= 0);
  assert.ok(!JSON.stringify(metrics).includes(secret)); assert.ok(!JSON.stringify(metrics).includes('合成原文'));
});
test('HTTP errors map to sanitized categories without retry or response body leakage', async t => {
  for (const [status, expected] of [[400,'INVALID_CONFIG'], [404,'INVALID_CONFIG'], [401,'AUTH_FAILED'], [402,'BALANCE'], [403,'PERMISSION_DENIED'], [408,'TIMEOUT'], [429,'RATE_LIMIT'], [500,'SERVER_ERROR'], [503,'SERVER_ERROR']] as const) {
    let count = 0; const base = await server(t, (_req,res) => { count++; res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: secret } })); });
    const adapter = createApiAdapter(credentials(base)); const req = { chunk: { chunkId: 'test', index: 0, core: [], context: [], request: '合成' }, profile, repair: false };
    await assert.rejects(adapter(req), (error: any) => { assert.equal(error.code, expected); assert.ok(!String(error).includes(secret)); return true; }); assert.equal(count, 1);
  }
});
test('a request that exceeds its deadline is distinguished from a network failure', async t => {
  const base = await server(t, (_req, _res) => {});
  const req = { chunk: { chunkId: 'test', index: 0, core: [], context: [], request: '合成' }, profile, repair: false };
  await assert.rejects(createApiAdapter(credentials(base), 30)(req), (error: any) => error.code === 'TIMEOUT' && !String(error).includes(secret));
});
test('a broken response stream is reported as a connection failure, not invalid model output', async t => {
  const base = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"choices":[]}\n\n'); setTimeout(() => res.destroy(), 20); });
  const req = { chunk: { chunkId: 'test', index: 0, core: [], context: [], request: '合成' }, profile, repair: false };
  await assert.rejects(createApiAdapter(credentials(base))(req), (error: any) => error.code === 'NETWORK');
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
test('a length-limited API response splits only that source range and retains every reference', async t => {
  const long = parseSource(Buffer.from('原文😀'.repeat(250)), '合成.txt'); const requests: any[][] = [];
  const base = await server(t, async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts).toString()); const input = JSON.parse(body.messages.at(-1).content.split('\n')[1]); requests.push(input.core);
    const size = input.core.reduce((n: number, ref: any) => n + ref.text.length, 0);
    if (size > 400) { send(res, '{', 'length'); return; }
    const refs = input.core.map(({ segmentId, startOffset, endOffset }: any) => ({ segmentId, startOffset, endOffset }));
    send(res, JSON.stringify({ title: '笔记', sections: [{ heading: '章节', refs, items: [{ kind: 'point', text: '要点', refs, children: [] }] }] }));
  });
  const value = await analyzeWithApi(long, credentials(base)); assert.ok(requests.length > 1);
  const refs = value.outline.sections.flatMap(section => section.refs).sort((a, b) => a.startOffset - b.startOffset);
  assert.equal(refs[0].startOffset, 0); assert.equal(refs.at(-1)?.endOffset, long.segments[0].text.length);
  for (let i = 1; i < refs.length; i++) assert.equal(refs[i - 1].endOffset, refs[i].startOffset);
  for (const request of requests) for (const ref of request) assert.doesNotMatch(ref.text, /[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
});
test('repeated length limits stop within a bounded number of calls and never publish partial output', async t => {
  const long = parseSource(Buffer.from('原文'.repeat(400)), '合成.txt'); let calls = 0;
  const base = await server(t, (_req, res) => { calls++; send(res, '{', 'length'); });
  await assert.rejects(analyzeWithApi(long, credentials(base)), (error: any) => error.code === 'TRUNCATED'); assert.ok(calls <= 4);
});

test('one file shares a request budget across format repair and truncation splitting',async t=>{
  let calls=0;
  const base=await server(t,(_req,res)=>{calls++;send(res,'{',calls===1?'stop':'length');});
  await assert.rejects(analyzeWithApi(source,credentials(base),{maxRequests:2}), (error:any)=>error.code==='REQUEST_LIMIT');
  assert.equal(calls,2);
});
test('whole-file deadline stops a waiting request and retains failure metrics',async t=>{
  const base=await server(t,(_req,res)=>{setTimeout(()=>{if(!res.destroyed)send(res,valid());},300);});
  let metrics:any;const began=performance.now();
  await assert.rejects(analyzeWithApi(source,credentials(base),{deadlineMs:50,onMetrics:value=>{metrics=value;}}),(error:any)=>error.code==='TIMEOUT');
  assert.ok(performance.now()-began<250);assert.equal(metrics.requests,1);assert.ok(metrics.apiMs>0);
});
test('range IDs distinguish disjoint ranges and context within the same Unicode segment',async t=>{
  const text='甲😀乙丙丁', id=source.segments[0].segmentId;
  const core=[{segmentId:id,startOffset:0,endOffset:3,text:text.slice(0,3)}];
  const context=[{segmentId:id,startOffset:4,endOffset:6,text:text.slice(4,6)}];
  const base=await server(t,async(req,res)=>{
    const parts=[];for await(const part of req)parts.push(part);
    const payload=JSON.parse(JSON.parse(Buffer.concat(parts).toString()).messages.at(-1).content.split('\n')[1]);
    assert.notEqual(payload.core[0].refId,payload.context[0].refId);
    const refs=[payload.core[0].refId,payload.context[0].refId];
    send(res,JSON.stringify({title:'范围',sections:[{heading:'章节',refs,items:[]}]}));
  });
  const result=await createApiAdapter(credentials(base))({chunk:{chunkId:'ranges',index:0,core,context,request:'规则\n'+JSON.stringify({core,context})},profile,repair:false});
  assert.deepEqual((result.value as any).sections[0].refs,[{segmentId:id,startOffset:0,endOffset:3},{segmentId:id,startOffset:4,endOffset:6}]);
});
