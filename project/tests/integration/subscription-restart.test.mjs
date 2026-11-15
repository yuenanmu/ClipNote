import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('subscription encrypted session survives client recreation',async()=>{
 await mkdir(join(process.cwd(),'.local'),{recursive:true});
 const directory=await mkdtemp(join(process.cwd(),'.local','restart-test-'));
 try{const output=join(directory,'test.mjs');await build({entryPoints:['tests/integration/subscription-restart-fixture.ts'],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});const result=spawnSync(process.execPath,['--test',output],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);}finally{await rm(directory,{recursive:true,force:true});}
});
