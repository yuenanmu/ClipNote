import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {findSmartSub,invokeSmartSub} from '../../src/modules/smartsub/cli.ts';

test('finds only complete SmartSub installations, preserving Chinese paths and spaces',async t=>{
  const own=await mkdtemp(join(tmpdir(),'clipnote-smartsub-'));t.after(()=>rm(own,{recursive:true,force:true}));
  const incomplete=join(own,'不完整'),installed=join(own,'中文 空格');
  await mkdir(join(incomplete,'resources','automation'),{recursive:true});await writeFile(join(incomplete,'SmartSub.exe'),'');
  await mkdir(join(installed,'resources','automation'),{recursive:true});await writeFile(join(installed,'SmartSub.exe'),'');await writeFile(join(installed,'resources','automation','cli.cjs'),'');
  assert.equal(await findSmartSub([join(own,'missing'),incomplete]),undefined);
  assert.deepEqual(await findSmartSub([incomplete,installed]),{root:installed,appPath:join(installed,'SmartSub.exe'),cliPath:join(installed,'resources','automation','cli.cjs')});
});

test('CLI operations pass JSON on stdin with fixed arguments and preserve paths safely',async t=>{
  const own=await mkdtemp(join(tmpdir(),'clipnote-cli-'));t.after(()=>rm(own,{recursive:true,force:true}));
  const script=join(own,'中文 test.cjs');await writeFile(script,"let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({args:process.argv.slice(2),input:JSON.parse(s),node:process.env.ELECTRON_RUN_AS_NODE}))); ");
  const install={root:own,appPath:process.execPath,cliPath:script};
  const result=await invokeSmartSub(install,'downloads.start',{url:'https://example.invalid/a?x=1&y=2'});
  assert.deepEqual(result,{args:['downloads','start','--input-json','-','--json'],input:{url:'https://example.invalid/a?x=1&y=2'},node:'1'});
  assert.deepEqual(await invokeSmartSub(install,'system.info',{}),{args:['system','info','--input-json','-','--json'],input:{},node:'1'});
  assert.deepEqual(await invokeSmartSub(install,'downloads.engines',{fetchRemote:false}),{args:['downloads','engines','--input-json','-','--json'],input:{fetchRemote:false},node:'1'});
  await assert.rejects(invokeSmartSub(install,'downloads.start;echo',{url:'x'}),/不支持|无效/);
  await assert.rejects(invokeSmartSub(install,'models.install',{model:'example'}),/不支持|无效/);
});

test('CLI deadline and cancellation stop only the owned CLI process',async t=>{
  const own=await mkdtemp(join(tmpdir(),'clipnote-cli-cancel-'));t.after(()=>rm(own,{recursive:true,force:true}));
  const script=join(own,'hang.cjs');await writeFile(script,"process.stdin.resume();setTimeout(()=>{},10000);");
  const install={root:own,appPath:process.execPath,cliPath:script};
  await assert.rejects(invokeSmartSub(install,'tasks.wait',{taskId:'synthetic'},{timeoutMs:100}),/超时/);
  const controller=new AbortController();setTimeout(()=>controller.abort(),50);
  await assert.rejects(invokeSmartSub(install,'tasks.wait',{taskId:'synthetic'},{signal:controller.signal}),/取消/);
});

test('CLI exit status distinguishes timeout and cancellation without leaking stderr',async t=>{
  const own=await mkdtemp(join(tmpdir(),'clipnote-cli-errors-'));t.after(()=>rm(own,{recursive:true,force:true}));
  const script=join(own,'failure.cjs');await writeFile(script,"let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{process.stderr.write('private-subtitle');process.exit(JSON.parse(s).code)});");
  const install={root:own,appPath:process.execPath,cliPath:script};
  for(const [code,word] of [[5,'超时'],[130,'取消'],[3,'失败']] as const){
    await assert.rejects(invokeSmartSub(install,'tasks.get',{code}),(error:any)=>{assert.ok(error.message.includes(word));assert.ok(!error.message.includes('private-subtitle'));return true;});
  }
  await assert.rejects(invokeSmartSub(install,'tasks.get',{value:'x'.repeat(70000)}),/输入无效/);
});
test('malformed or oversized CLI output fails without exposing its contents',async t=>{
  const own=await mkdtemp(join(tmpdir(),'clipnote-cli-output-'));t.after(()=>rm(own,{recursive:true,force:true}));
  const script=join(own,'output.cjs');await writeFile(script,"let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>process.stdout.write(JSON.parse(s).large?'x'.repeat(1100000):'private-subtitle'));");
  const install={root:own,appPath:process.execPath,cliPath:script};
  for(const input of [{large:false},{large:true}])await assert.rejects(invokeSmartSub(install,'tasks.get',input),(error:any)=>{assert.ok(!error.message.includes('private-subtitle'));return /无效|上限/.test(error.message);});
});
