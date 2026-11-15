import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {makeDownloadRequest,makeTaskRequest,makeWaitRequest,makeSubtitleReadRequest} from '../../src/modules/smartsub/requests.ts';

test('a confirmed link produces a stable subtitle-first request without enabling transcription',()=>{
  const cache=resolve('合成 临时'),url='https://example.invalid/watch?v=synthetic',requestId='11111111-1111-4111-8111-111111111111';
  const result=makeDownloadRequest(url,cache,requestId) as any;
  assert.deepEqual(result,{requestId,config:{name:'ClipNote',savePath:cache,quality:'best',engine:'auto',writeSubs:true,entries:[{url}]}});
  assert.deepEqual(makeDownloadRequest(url,cache,requestId),result);
});
test('task and subtitle inputs retain exact task IDs, bounded waits and paging',()=>{
  const file=resolve('合成 文件.srt');
  assert.deepEqual(makeTaskRequest('task-123'),{id:'task-123'});
  assert.deepEqual(makeWaitRequest('task-123',25000),{id:'task-123',timeoutMs:25000});
  assert.deepEqual(makeSubtitleReadRequest(file,500,100),{filePath:file,offset:500,limit:100});
  for(const id of ['', 'task\n123', 'x'.repeat(257)])assert.throws(()=>makeTaskRequest(id));
  for(const timeout of [-1,25001,NaN])assert.throws(()=>makeWaitRequest('task',timeout));
  for(const limit of [0,501,1.5])assert.throws(()=>makeSubtitleReadRequest(file,0,limit));
  assert.throws(()=>makeSubtitleReadRequest('relative.srt',0,100));
  assert.throws(()=>makeSubtitleReadRequest(file,-1,100));
});
test('link input rejects unsupported protocols, embedded credentials, malformed IDs and relative cache paths',()=>{
  const cache=resolve('synthetic'),id='11111111-1111-4111-8111-111111111111';
  for(const url of ['file:///private','javascript:alert(1)','https://name:secret@example.invalid','invalid','https://example.invalid/\n'])assert.throws(()=>makeDownloadRequest(url,cache,id));
  assert.throws(()=>makeDownloadRequest('https://example.invalid','relative',id));
  assert.throws(()=>makeDownloadRequest('https://example.invalid',cache,'invalid'));
});
