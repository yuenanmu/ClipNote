import {cp,mkdir,mkdtemp,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),outRoot=resolve(root,'../.local/releases');await mkdir(outRoot,{recursive:true});
const output=await mkdtemp(join(outRoot,'ClipNote-candidate-'));const electron=resolve(root,'node_modules/electron/dist');await cp(electron,output,{recursive:true});
await rename(join(output,'electron.exe'),join(output,'ClipNote.exe'));
const resourceDir=resolve(root,'tools/windows'),object=join(output,'clipnote-res.o'),library=join(output,'clipnote-res.dll');
execFileSync('windres',['clipnote.rc','-O','coff','-o',object],{cwd:resourceDir});execFileSync('gcc',['-shared',object,'-o',library]);
execFileSync('powershell.exe',['-NoProfile','-File',join(resourceDir,'update-identity.ps1'),'-Source',library,'-Target',join(output,'ClipNote.exe')]);
const {unlink}=await import('node:fs/promises');await unlink(object);await unlink(library);
const app=join(output,'resources','app');await mkdir(app,{recursive:true});await cp(resolve(root,'dist'),join(app,'dist'),{recursive:true});
await writeFile(join(app,'package.json'),JSON.stringify({name:'clipnote',productName:'ClipNote',version:'0.1.0-candidate',main:'dist/main/index.cjs'},null,2));
const paths=execFileSync('npm.cmd',['ls','--omit=dev','--all','--parseable'],{cwd:root,encoding:'utf8',shell:true}).split(/\r?\n/).slice(1).filter(Boolean);
const inventory=new Map(),missingNotices=new Map();
for(const path of paths){const rel=relative(root,path);if(isAbsolute(rel)||rel.startsWith('..')||!rel.startsWith('node_modules'))throw new Error('Unexpected dependency path');await cp(path,join(app,rel),{recursive:true,force:true});try{const dep=JSON.parse(await readFile(join(path,'package.json'),'utf8'));const key=`${dep.name}@${dep.version}`;inventory.set(key,dep.license??dep.licenses??'UNKNOWN');if(!(await readdir(path)).some(name=>/^(licen[sc]e|copying|notice)(\.|$)/i.test(name)))missingNotices.set(key,dep.license??dep.licenses??'UNKNOWN');}catch{throw new Error('Cannot read dependency metadata: '+rel);}}
await cp(resolve(root,'../docs/Windows候选使用说明.md'),join(output,'使用说明.md'));
const notices=join(output,'licenses');await mkdir(notices);await cp(resolve(root,'vendor/siwc/LICENSE'),join(notices,'SIWC-LICENSE.txt'));await cp(resolve(root,'vendor/siwc/THIRD_PARTY_NOTICES.md'),join(notices,'SIWC-THIRD-PARTY.md'));await writeFile(join(notices,'production-dependencies.json'),JSON.stringify(Object.fromEntries([...inventory].sort()),null,2));await writeFile(join(notices,'unresolved-notices.json'),JSON.stringify(Object.fromEntries([...missingNotices].sort()),null,2));
console.log(output);
