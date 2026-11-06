import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionHandlers } from '../../src/main/subscription-controller.ts';

test('subscription IPC rejects untrusted callers and unexpected arguments', async () => {
  let calls = 0;
  const client = { getSession: async () => { calls++; return {status:'disconnected', sharing:false}; } };
  const handlers = createSubscriptionHandlers(client, event => event === 'trusted');
  assert.equal((await handlers.state('untrusted') as any).status, 'error');
  assert.equal((await handlers.state('trusted', 'extra') as any).status, 'error');
  assert.equal(calls, 0);
  assert.equal((await handlers.state('trusted') as any).value.status, 'disconnected');
});

test('cancellation remains available while the browser sign-in is pending', async () => {
  let cancel = () => {};
  const client = { signIn: () => new Promise((_resolve, reject) => { cancel = () => reject(Object.assign(new Error('secret'), {code:'cancelled'})); }), cancelSignIn: () => cancel() };
  const handlers = createSubscriptionHandlers(client, () => true);
  const pending = handlers.signIn('trusted');
  await Promise.resolve();
  assert.equal((await handlers.cancel('trusted') as any).status, 'ok');
  const result = await pending as any;
  assert.equal(result.error.code, 'cancelled');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('subscription IPC exposes only the session and model fields needed by the UI', async () => {
  const handlers = createSubscriptionHandlers({
    getSession: async () => ({status:'connected', sharing:true, profileId:'p', identity:{email:'a@example.test', secret:'hidden'}, credentials:'hidden'}),
    listModels: async () => [{slug:'model', displayName:'Model', token:'hidden'}],
  }, () => true);
  assert.deepEqual((await handlers.state('trusted')).value, {status:'connected',sharing:true,profileId:'p',identity:{email:'a@example.test'}});
  assert.deepEqual((await handlers.models('trusted')).value, [{slug:'model',displayName:'Model'}]);
});

test('storage errors retain a safe actionable message without leaking details',async()=>{
 const handlers=createSubscriptionHandlers({getSession:async()=>({status:'reauth_required',sharing:false,error:{code:'storage_encryption_unavailable',message:'private detail'}}),signIn:async()=>{throw Object.assign(new Error('secret'),{code:'storage_encryption_unavailable'});}},()=>true);
 const state=await handlers.state('trusted');assert.match(state.value.error.message,/加密/);assert.doesNotMatch(JSON.stringify(state),/private detail/);
 const signIn=await handlers.signIn('trusted');assert.equal(signIn.error.code,'storage_encryption_unavailable');assert.doesNotMatch(JSON.stringify(signIn),/secret/);
});
