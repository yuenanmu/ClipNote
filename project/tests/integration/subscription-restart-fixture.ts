import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {ConnectionStore} from '../../vendor/siwc/src/storage.ts';
import {createChatGPT} from '../../vendor/siwc/src/index.ts';

test('encrypted synthetic session is restored by a new client instance',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'clipnote-session-'));const key=randomBytes(32);
 const encryption={id:'test-key',isAvailable:()=>true,encrypt:(text:string)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);},decrypt:(bytes:Uint8Array)=>{const b=Buffer.from(bytes),decipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));decipher.setAuthTag(b.subarray(12,28));return Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString('utf8');}};
 try{const store=new ConnectionStore(directory,encryption);await store.withLock(()=>store.write({version:2,activeProfileId:'profile-1',pendingRegistrations:[],profiles:[{version:1,id:'profile-1',label:'Test',clientId:'client-1',status:'connected',scopes:['chatgpt.tokens.use.direct'],savedAt:new Date().toISOString(),credentials:{accessToken:'synthetic-secret-token',expiresAt:Date.now()+3600000}}]}));
 const raw=await readFile(join(directory,'chatgpt-auth.json'),'utf8');assert.doesNotMatch(raw,/synthetic-secret-token/);
 const client=createChatGPT({appName:'ClipNote',appId:'clipnote',redirectPort:0,storageDir:directory,credentialEncryption:encryption});const state=await client.getSession();assert.equal(state.status,'connected');assert.equal(state.profileId,'profile-1');assert.equal(state.sharing,true);assert.doesNotMatch(JSON.stringify(state),/synthetic-secret-token/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
