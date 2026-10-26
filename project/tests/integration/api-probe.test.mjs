import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function withApi(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/v1`;
}
async function runProbe(baseUrl) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../tools/verify-api.mjs', import.meta.url))], { shell: false, windowsHide: true, env: { ...process.env, CLIPNOTE_API_KEY: 'synthetic-test-key', CLIPNOTE_MODEL: 'synthetic-model', CLIPNOTE_API_BASE_URL: baseUrl }, timeout: 15000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', part => { stdout += part; });
    child.stderr.on('data', part => { stderr += part; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('the API probe uses the configured endpoint, model and auth through the installed SDK', async t => {
  let received;
  const url = await withApi(t, async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    received = { path: request.url, auth: request.headers.authorization, body: JSON.parse(Buffer.concat(parts).toString()) };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'synthetic-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'ClipNote OK' }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'synthetic-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  const result = await runProbe(url);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(received.path, '/v1/chat/completions');
  assert.equal(received.auth, 'Bearer synthetic-test-key');
  assert.equal(received.body.model, 'synthetic-model');
  assert.equal(JSON.parse(result.stdout).scope, 'api-text-request');
  assert.equal(result.stdout.includes('synthetic-test-key'), false);
});

test('the API probe fails without leaking service error text or its key', async t => {
  const url = await withApi(t, (_, response) => {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'synthetic-test-key must never appear in the report', type: 'authentication_error' } }));
  });
  const result = await runProbe(url);
  assert.equal(result.code, 1);
  assert.equal(JSON.parse(result.stderr).status, 'failed');
  assert.equal(JSON.parse(result.stderr).category, 'authentication-failed');
  assert.equal(JSON.parse(result.stderr).httpStatus, 401);
  assert.equal((result.stdout + result.stderr).includes('synthetic-test-key'), false);
});

test('the API probe distinguishes quota errors without returning service text', async t => {
  const url = await withApi(t, (_, response) => {
    response.writeHead(429, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'synthetic-test-key', type: 'rate_limit_error' } }));
  });
  const result = await runProbe(url);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stderr);
  assert.equal(report.category, 'usage-limit-exceeded');
  assert.equal(report.httpStatus, 429);
  assert.equal(result.stderr.includes('synthetic-test-key'), false);
});
