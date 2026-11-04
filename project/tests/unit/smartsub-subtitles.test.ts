import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadSmartSubSubtitle} from '../../src/modules/smartsub/subtitles.ts';
test('reads paged subtitle cues and returns the original local source with timing',async t=>{
  const own=await mkdtemp(join(tmpdir(),'clipnote-subs-'));t.after(()=>rm(own,{recursive:true,force:true}));
  const path=join(own,'中文.srt');const text='1\n00:00:01,000 --> 00:00:02,000\n原文一\n\n2\n00:00:03,000 --> 00:00:04,000\n原文二\n';await writeFile(path,text);
  const calls:number[]=[];
  const result:any=await loadSmartSubSubtitle(own,path,async(offset,limit)=>{calls.push(offset);assert.equal(limit,500);return {filePath:path,version:'v1',format:'srt',total:2,offset,cues:[{startMs:1000,endMs:2000,text:'原文一'},{startMs:3000,endMs:4000,text:'原文二'}]};});
  assert.deepEqual(calls,[0]);assert.equal(result.document.rawText,text);assert.equal(result.document.segments[0].startMs,1000);assert.equal(result.document.segments.length,2);
});
test('rejects changed files, inconsistent pages and invalid cues without returning partial content',async t=>{
  const own=await mkdtemp(join(tmpdir(),'clipnote-subs-'));t.after(()=>rm(own,{recursive:true,force:true}));const path=join(own,'a.srt');
  await writeFile(path,'1\n00:00:01,000 --> 00:00:02,000\n合成\n');
  await assert.rejects(loadSmartSubSubtitle(own,path,async(offset)=>{await writeFile(path,'modified');return {filePath:path,version:'v1',format:'srt',total:1,offset,cues:[{startMs:1000,endMs:2000,text:'合成'}]};}));
  await writeFile(path,'1\n00:00:01,000 --> 00:00:02,000\n合成\n');
  await assert.rejects(loadSmartSubSubtitle(own,path,async(offset)=>({filePath:path,version:'v1',format:'srt',total:1,offset,cues:[{startMs:2000,endMs:1000,text:'合成'}]})));
  await assert.rejects(loadSmartSubSubtitle(own,path,async(offset)=>({filePath:path,version:'v1',format:'srt',total:1,offset,cues:[]})));
});
