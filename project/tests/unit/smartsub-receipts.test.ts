import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {parseTaskReceipt} from '../../src/modules/smartsub/receipts.ts';

test('extracts only unique supported subtitle paths from a completed SmartSub task',()=>{
  const root=resolve('test-cache'),a=join(root,'a.zh.srt'),b=join(root,'b.vtt'),video=join(root,'a.mp4');
  const value={id:'job1',status:'completed',artifacts:[{kind:'srt',path:a},{kind:'mp4',path:video}],result:{downloadEntries:[{subtitlePaths:[a,b]}],artifacts:[{kind:'subtitle',path:a}]}};
  assert.deepEqual(parseTaskReceipt(value,'job1',root),{id:'job1',status:'completed',subtitlePaths:[a,b],mediaPaths:[video],hasSubtitles:true});
  assert.deepEqual(parseTaskReceipt({id:'job1',status:'running',result:{downloadEntries:[{subtitlePaths:[a]}]}},'job1',root),{id:'job1',status:'running',subtitlePaths:[],mediaPaths:[],hasSubtitles:false});
  const unsupported=join(root,'original.ass');const receipt=parseTaskReceipt({id:'job1',status:'completed',result:{downloadEntries:[{subtitlePaths:[unsupported]}]}},'job1',root);assert.equal(receipt.hasSubtitles,true);assert.deepEqual(receipt.subtitlePaths,[]);
});
test('rejects mismatched task IDs, unknown states and subtitle paths outside the task cache',()=>{
  const root=resolve('test-cache'),outside=resolve('outside.srt');
  assert.throws(()=>parseTaskReceipt({id:'other',status:'completed'},'job1',root));
  assert.throws(()=>parseTaskReceipt({id:'job1',status:'unknown'},'job1',root));
  assert.throws(()=>parseTaskReceipt({id:'job1',status:'completed',result:{downloadEntries:[{subtitlePaths:[outside]}]}},'job1',root));
  assert.throws(()=>parseTaskReceipt({id:'job1',status:'completed',artifacts:[{kind:'srt',path:'relative.srt'}]},'job1',root));
});
