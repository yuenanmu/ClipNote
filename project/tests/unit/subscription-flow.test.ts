import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {WorkspaceFiles} from '../../src/modules/workspace/files.ts';
import {NoteResults} from '../../src/modules/workspace/results.ts';
import {parseSource} from '../../src/modules/source/parser.ts';
import {analyzeSubscription} from '../../src/modules/subscription/analyze.ts';
import {createSubscriptionTask} from '../../src/main/subscription-task.ts';

test('synthetic subscription workflow stages, confirms and reads a generated note',async t=>{
 const base=join(process.cwd(),'.local','test-artifacts');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'subscription-flow-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const sources=join(dir,'sources'),notes=join(dir,'notes');await mkdir(sources);await mkdir(notes);await writeFile(join(sources,'fixture.txt'),'测试来源内容');
 const ws=new WorkspaceFiles(join(dir,'state')),sr=await ws.choose('source',sources),nr=await ws.choose('notes',notes),entry=(await ws.list('source',sr.id)).entries[0],results=new NoteResults(join(dir,'results'),ws);
 const client={getSession:async()=>({status:'connected',sharing:true,profileId:'account'}),streamResponse:async({input}:{input:string})=>{const payload=JSON.parse(input.slice(input.indexOf('\n')+1).replace(/\n请仅输出完整 JSON。$/, ''));const {segmentId,startOffset,endOffset}=payload.core[0];const ref={segmentId,startOffset,endOffset};return {text:JSON.stringify({title:'合成笔记',sections:[{heading:'主题',refs:[ref],items:[{kind:'point',text:'可核对内容',refs:[ref],children:[]}]}]})};}};
 const task=createSubscriptionTask({trusted:()=>true,session:client.getSession,models:async()=>[{slug:'model'}],preview:(id,folder)=>ws.previewOutput(id,folder),analyze:async(id,_plan,profile,model,instructions,signal)=>{const path=await ws.filePath('source',id),source=parseSource(await readFile(path),path);return (await analyzeSubscription(source,client,profile,model,{instructions,signal})).markdown;},stage:(plan,markdown)=>results.add(plan,markdown)});
 assert.equal((await task.prepare(null,entry.id,nr.id,'model','')).status,'ok');await task.start(null);
 let state:any;for(let i=0;i<100;i++){state=(await task.state(null) as any).value;if(state.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(state.status,'done',state.error);assert.equal((await ws.list('notes',nr.id)).entries.length,0);const saved=(await results.list())[0];assert.equal(saved.id,state.resultId);const preview=await results.prepare(saved.id);await results.save(preview.token);const note=(await ws.list('notes',nr.id)).entries[0];assert.match((await ws.readNote(note.id)).text,/可核对内容/);assert.equal((await results.list()).length,0);
});
