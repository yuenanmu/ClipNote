import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSmartSub} from '../../src/modules/smartsub/readiness.ts';

test('readiness checks version, capabilities and locally installed downloaders without network updates',async()=>{
  const calls:any[]=[];
  const result=await inspectSmartSub(async(op,input)=>{calls.push([op,input]);if(op==='system.info')return {version:'3.10.1',apiVersion:1};if(op==='system.capabilities')return ['downloads.start','tasks.get','tasks.cancel','subtitles.read','transcribe','settings.get','engines.list','models.list'].map(name=>({name}));return [{engine:'yt-dlp',installed:{version:'test'}},{engine:'lux',installed:null}];});
  assert.deepEqual(result,{version:'3.10.1',compatible:true,transcriptionCompatible:true,downloaders:['yt-dlp']});
  assert.deepEqual(calls[2],['downloads.engines',{fetchRemote:false}]);
});
test('readiness rejects malformed results and marks missing capabilities',async()=>{
  assert.equal((await inspectSmartSub(async(op)=>op==='system.info'?{version:'3.10.1',apiVersion:1}:op==='system.capabilities'?[]:[])).compatible,false);
  assert.equal((await inspectSmartSub(async(op)=>op==='system.info'?{version:'3.10.1',apiVersion:1}:op==='system.capabilities'?['downloads.start','tasks.get','tasks.cancel','subtitles.read'].map(name=>({name})):[])).transcriptionCompatible,false);
  await assert.rejects(inspectSmartSub(async()=>null));
});
