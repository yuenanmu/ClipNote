import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileSha256} from '../../tools/build-provenance.mjs';
test('candidate file digest detects changed bytes',async()=>{const dir=await mkdtemp(join(tmpdir(),'clipnote-digest-'));try{const file=join(dir,'file');await writeFile(file,'one');const a=await fileSha256(file);assert.match(a,/^[a-f0-9]{64}$/);await writeFile(file,'two');assert.notEqual(await fileSha256(file),a);}finally{await rm(dir,{recursive:true,force:true});}});
