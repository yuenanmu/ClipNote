import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
export async function fileSha256(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function buildProvenance(projectRoot,executable){
 const repo=resolve(projectRoot,'..');const git=(...args)=>execFileSync('git',['-c',`safe.directory=${repo.replaceAll('\\','/')}`,...args],{cwd:repo,encoding:'utf8'}).trim();
 return {format:1,sourceCommit:git('rev-parse','HEAD'),sourceDirty:git('status','--porcelain','--untracked-files=normal').length>0,electronVersion:JSON.parse(await (await import('node:fs/promises')).readFile(resolve(projectRoot,'node_modules/electron/package.json'),'utf8')).version,lockSha256:await fileSha256(resolve(projectRoot,'package-lock.json')),executableSha256:await fileSha256(executable)};
}
