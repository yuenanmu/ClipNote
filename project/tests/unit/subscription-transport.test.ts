import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionFetch } from '../../src/modules/subscription/transport.ts';

test('subscription requests use the supplied system transport and reject redirects', async () => {
  let received: Request | undefined;
  const transport = createSubscriptionFetch(async (input, init) => {
    received = new Request(input, init);
    return new Response('synthetic');
  });
  const abort = new AbortController();
  await transport('https://api.openai.com/v1/responses', {
    method: 'POST', body: 'synthetic input', signal: abort.signal,
    headers: { authorization: 'Bearer synthetic-token' }, redirect: 'follow',
  });
  assert.equal(received?.redirect, 'error');
  assert.equal(received?.credentials, 'omit');
  assert.equal(received?.headers.get('authorization'), 'Bearer synthetic-token');
  assert.equal(await received?.text(), 'synthetic input');
  abort.abort();
  assert.equal(received?.signal.aborted, true);
});

test('foreign origins and credentials embedded in URLs are rejected before transport', async () => {
  let calls = 0;
  const transport = createSubscriptionFetch(async () => { calls++; return new Response(); });
  for (const url of ['https://example.invalid/', 'http://auth.openai.com/', 'https://auth.openai.com.example.invalid/', 'https://user:synthetic@auth.openai.com/']) {
    await assert.rejects(transport(url), /SUBSCRIPTION_ENDPOINT_REJECTED/);
  }
  assert.equal(calls, 0);
});

test('official discovery supports Request input while an already cancelled request sends nothing', async () => {
  let calls = 0;
  const transport = createSubscriptionFetch(async () => { calls++; return Response.json({ issuer: 'synthetic' }); });
  await transport(new Request('https://auth.openai.com/.well-known/openid-configuration'));
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(transport('https://api.openai.com/v1/models', { signal: abort.signal }));
  assert.equal(calls, 1);
});
