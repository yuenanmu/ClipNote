import test from 'node:test';
import assert from 'node:assert/strict';
import {createSmartSubDiscoveryHandlers} from '../../src/main/smartsub-controller.ts';

test('installation detection and user selection reject untrusted input and persist only a valid selected directory',async()=>{
  const valid={root:'C:/synthetic/SmartSub',appPath:'C:/synthetic/SmartSub/SmartSub.exe',cliPath:'C:/synthetic/SmartSub/resources/automation/cli.cjs'};
  let selected:string|undefined,dialogValue:string|undefined,opened=0;
  const handlers=createSmartSubDiscoveryHandlers({isTrustedSender:(event:unknown)=>event==='trusted',load:async()=>selected,save:async(path:string)=>{selected=path;},candidates:()=>['C:/missing'],find:async(paths:string[])=>paths.includes(valid.root)?valid:undefined,choose:async()=>dialogValue,openOfficial:async()=>{opened++;}});
  assert.equal((await handlers.state('untrusted')).status,'error');
  assert.equal((await handlers.choose('trusted','arbitrary path')).status,'error');
  assert.deepEqual(await handlers.state('trusted'),{status:'ok',value:{installed:false}});
  assert.equal((await handlers.choose('trusted')).status,'cancelled');assert.equal(selected,undefined);
  dialogValue='C:/wrong';assert.equal((await handlers.choose('trusted')).status,'error');assert.equal(selected,undefined);
  dialogValue=valid.root;assert.deepEqual(await handlers.choose('trusted'),{status:'ok',value:{installed:true,path:valid.root}});assert.equal(selected,valid.root);
  assert.deepEqual(await handlers.state('trusted'),{status:'ok',value:{installed:true,path:valid.root}});
  assert.equal((await handlers.openOfficial('trusted')).status,'ok');assert.equal(opened,1);
});

test('parallel read-only discovery cannot block task cancellation with a busy error',async()=>{
  let finish!:(value:undefined)=>void;
  const handlers=createSmartSubDiscoveryHandlers({isTrustedSender:()=>true,load:async()=>undefined,save:async()=>{},candidates:()=>[],find:()=>new Promise(resolve=>{finish=resolve;}),choose:async()=>undefined,openOfficial:async()=>{}});
  const first=handlers.state('trusted');await new Promise(resolve=>setImmediate(resolve));const releaseFirst=finish;
  const second=handlers.state('trusted');await new Promise(resolve=>setImmediate(resolve));const releaseSecond=finish;
  releaseFirst(undefined);releaseSecond(undefined);
  assert.equal((await first).status,'ok');assert.equal((await second).status,'ok');
});
