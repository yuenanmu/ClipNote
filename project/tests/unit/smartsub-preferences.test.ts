import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SmartSubPreferences} from '../../src/modules/smartsub/preferences.ts';
import {createSmartSubPreferencesHandlers} from '../../src/main/smartsub-preferences-controller.ts';

test('settings bridge rejects untrusted senders and excess arguments before accessing preferences',async()=>{
  let calls=0;const handlers=createSmartSubPreferencesHandlers(event=>event==='trusted',{state:async()=>{calls++;return {selection:null,options:[]};},save:async()=>{calls++;return {engine:'builtin',model:'small'};}});
  assert.equal((await handlers.state('other')).status,'error');assert.equal((await handlers.state('trusted','extra')).status,'error');
  assert.equal((await handlers.save('other',{})).status,'error');assert.equal((await handlers.save('trusted',{},'extra')).status,'error');assert.equal(calls,0);
  assert.equal((await handlers.state('trusted')).status,'ok');assert.equal(calls,1);
});

test('damaged saved configuration still allows resource selection and explicit repair',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-prefs-repair-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'preferences.json');await writeFile(path,'invalid json');
  const prefs=new SmartSubPreferences(path,async op=>op==='engines.list'?{builtin:{state:'ready'}}:{modelsInstalled:['small']});
  await assert.rejects(prefs.selection());const state=await prefs.state();assert.equal(state.selection,null);assert.ok(state.warning);assert.ok(state.options.find(v=>v.id==='builtin')?.models.includes('small'));
  await prefs.save({engine:'builtin',model:'small'});assert.deepEqual(await prefs.selection(),{engine:'builtin',model:'small'});assert.equal((await prefs.state()).warning,undefined);
});

test('local model choices persist, reject missing resources and malformed input without replacing the saved selection',async t=>{
  const root=await mkdtemp(join(tmpdir(),'clipnote-preferences-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const calls:string[]=[];const invoke=async(op:string)=>{calls.push(op);if(op==='engines.list')return {builtin:{state:'ready'}};if(op==='models.list')return {modelsInstalled:['small','medium']};throw Error('unexpected operation');};
  const path=join(root,'preferences.json'),prefs=new SmartSubPreferences(path,invoke);
  assert.equal(await prefs.selection(),undefined);
  assert.deepEqual((await prefs.state()).options.find(v=>v.id==='builtin'),{id:'builtin',ready:true,models:['small','medium']});
  await prefs.save({engine:'builtin',model:'medium'});
  for(const value of [null,{engine:'cloud',model:'x'},{engine:'builtin',model:'missing'},{engine:'builtin',model:'small',args:'--unsafe'}])await assert.rejects(prefs.save(value));
  assert.deepEqual(await new SmartSubPreferences(path,invoke).selection(),{engine:'builtin',model:'medium'});
  assert.ok(calls.every(op=>['engines.list','models.list'].includes(op)));
});
