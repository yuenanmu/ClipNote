import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowHandlers } from '../../src/main/workflow-controller.ts';
import { parseSource } from '../../src/modules/source/parser.ts';
import { StorageError } from '../../src/modules/storage/errors.ts';
const bytes = Buffer.from('合成原文'); const document = parseSource(bytes, '合成.txt'); const snapshot = { document, bytes };
const credentials = { baseUrl: 'https://example.invalid/v1', model: 'fixture', apiKey: 'synthetic-secret', contextWindow: 8192, maxTokens: 2048 };
const revision = { sourceId: document.sourceId, revisionId: 'b5f4af75-c33e-49ef-ae3c-65fc2d939c83', title: '合成.txt', createdAt: new Date().toISOString(), kind: 'generated-note', directory: '/test', notePath: '/test/note.md', sourcePath: '/test/source.txt', manifestPath: '/test/manifest.json', noteModified: false };
const result = { markdown: '# 合成笔记', sourceRefs: [document.segments[0].segmentId], attempt: { provider: 'api:fixture', model: 'fixture', promptVersion: 'v1', planId: 'x' }, outline: { title: '合成', sections: [] }, checkpoints: [] };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(handler: any, status: string) { for (let n=0;n<100;n++) { const state=await handler.state('trusted'); if (state.value?.status===status) return state.value; await tick(); } throw new Error(`State did not reach ${status}`); }
function setup(overrides: any = {}) { let requests=0, saves=0; const handlers=createWorkflowHandlers({ isTrustedSender: (e: unknown)=>e==='trusted', source: (id: string)=>id===document.sourceId?snapshot:undefined, credentials: async()=>credentials, hasDirectory: async()=>true, analyze: async (_s: any,_c: any,opts: any)=>{ requests++; opts.onCheckpoint({}); return result; }, save: async()=>{ saves++; return revision; }, resume: async()=>revision, ...overrides }); return { handlers, counts:()=>({requests,saves}) }; }

test('trusted explicit start uses known snapshot, reports progress and saves a generated version', async () => {
  const f=setup(); const initial = await f.handlers.state('trusted'); assert.ok(initial.status === 'ok'); assert.equal(initial.value.status,'idle'); assert.deepEqual(f.counts(),{requests:0,saves:0});
  assert.equal((await f.handlers.start('other',document.sourceId)).status,'error'); assert.equal((await f.handlers.start('trusted','unknown')).status,'error'); assert.deepEqual(f.counts(),{requests:0,saves:0});
  assert.equal((await f.handlers.start('trusted',document.sourceId,{baseUrl:credentials.baseUrl,model:credentials.model})).status,'ok'); const state=await until(f.handlers,'succeeded'); assert.equal(state.completedChunks,1); assert.equal(state.revision.revisionId,revision.revisionId); assert.deepEqual(f.counts(),{requests:1,saves:1}); assert.ok(!JSON.stringify(state).includes(credentials.apiKey));
});
test('missing directory or credentials does not send source and retains safe error', async () => {
  const f=setup({hasDirectory:async()=>false}); await f.handlers.start('trusted',document.sourceId,{baseUrl:credentials.baseUrl,model:credentials.model}); const s=await until(f.handlers,'failed'); assert.equal(s.error.code,'DIRECTORY_REQUIRED'); assert.deepEqual(f.counts(),{requests:0,saves:0});
});
test('failed save can be retried without re-running analysis, including an existing prepared draft', async () => {
  let saves=0, resumes=0; const draft='e77024bc-9188-4406-b15a-835bc32ea8c9'; const f=setup({ save:async()=>{saves++; throw new StorageError('STORAGE_FULL',draft);}, resume:async(id: string)=>{resumes++; assert.equal(id,draft); return revision;} });
  await f.handlers.start('trusted',document.sourceId,{baseUrl:credentials.baseUrl,model:credentials.model}); const failed=await until(f.handlers,'failed'); assert.equal(failed.error.code,'STORAGE_FULL'); assert.equal(failed.canRetrySave,true);
  assert.equal((await f.handlers.retry('trusted')).status,'ok'); await until(f.handlers,'succeeded'); assert.equal(saves,1); assert.equal(resumes,1); assert.equal(f.counts().requests,1);
});
test('cancel stops analysis, retains original source, and blocks concurrent starts', async () => {
  let saved=0; const f=setup({ analyze:async (_s: any,_c: any,opts: any)=>{ await new Promise<void>((resolve,reject)=>{ opts.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}); }); return result; }, save:async()=>{saved++;return revision;} });
  await f.handlers.start('trusted',document.sourceId,{baseUrl:credentials.baseUrl,model:credentials.model}); await until(f.handlers,'running'); assert.equal((await f.handlers.start('trusted',document.sourceId,{baseUrl:credentials.baseUrl,model:credentials.model})).status,'error'); await f.handlers.cancel('trusted'); await until(f.handlers,'cancelled'); assert.equal(saved,0);
});
test('changed service after user confirmation never receives the source', async () => {
  const f=setup(); await f.handlers.start('trusted',document.sourceId,{baseUrl:'https://other.invalid/v1',model:credentials.model}); const state=await until(f.handlers,'failed'); assert.equal(state.error.code,'CONFIG_CHANGED'); assert.deepEqual(f.counts(),{requests:0,saves:0});
});
