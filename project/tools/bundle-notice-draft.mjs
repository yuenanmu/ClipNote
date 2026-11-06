import {copyFile,mkdir,readFile,readdir,realpath,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename,isAbsolute,join,relative,resolve} from 'node:path';

const supplements=new Map([
  ['@earendil-works/pi-ai@1.4.0','pi-1.4.0-MIT.txt'],
  ['@earendil-works/pi-telemetry@1.4.0','pi-1.4.0-MIT.txt'],
  ['format@0.2.2','format-upstream-MIT.md'],
]);
function inside(root,path) {
  const rel=relative(root,path);
  return rel!=='' && !isAbsolute(rel) && rel!=='..' && !rel.startsWith(`..${process.platform==='win32'?'\\':'/'}`);
}

// Produces an internal draft. It does not decide whether a notice is legally sufficient.
export async function createNoticeDraft({projectRoot,outputDir,packages}) {
  const root=await realpath(projectRoot),modules=await realpath(join(root,'node_modules'));
  if (!inside(root,modules)) throw new Error('Invalid dependency path');
  const merged=new Map();
  for (const p of packages) {
    const dir=await realpath(p.path);
    if (!inside(modules,dir)) throw new Error('Invalid dependency path');
    const meta=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
    if (meta.name!==p.name || meta.version!==p.version) throw new Error('Dependency metadata mismatch');
    const key=`${meta.name}@${meta.version}`,existing=merged.get(key);
    if (existing && existing.dir!==dir) throw new Error('Duplicate dependency paths require review');
    const row=existing??{name:meta.name,version:meta.version,declaredLicense:meta.license??meta.licenses??null,dir,groups:new Set()};
    for (const group of p.groups??[]) { if (!['main','renderer'].includes(group)) throw new Error('Invalid group'); row.groups.add(group); }
    merged.set(key,row);
  }
  const prepared=[];
  for (const [key,row] of [...merged].sort(([a],[b])=>a.localeCompare(b))) {
    let names=(await readdir(row.dir,{withFileTypes:true})).filter(x=>x.isFile()&&/^(licen[sc]e|copying|notice)(\.|$)/i.test(x.name)).map(x=>x.name).sort();
    let noticeSource='package',sourceDir=row.dir;
    if (!names.length) {
      const name=supplements.get(key);if (!name) throw new Error(`Missing notice: ${key}`);
      sourceDir=await realpath(join(root,'licenses'));if (!inside(root,sourceDir)) throw new Error('Invalid supplemental path');
      names=[name];noticeSource='supplemental';
    }
    const id=createHash('sha256').update(key).digest('hex').slice(0,16),files=[];
    for (const name of names) {
      const source=await realpath(join(sourceDir,name));if (!inside(sourceDir,source)) throw new Error('Invalid notice path');
      files.push({source,target:`${id}-${basename(name)}`});
    }
    prepared.push({row,noticeSource,files});
  }
  await mkdir(resolve(outputDir));
  const inventory=[];
  for (const {row,noticeSource,files} of prepared) {
    for (const file of files) await copyFile(file.source,join(outputDir,file.target));
    inventory.push({name:row.name,version:row.version,declaredLicense:row.declaredLicense,groups:[...row.groups].sort(),noticeSource,files:files.map(x=>x.target)});
  }
  await writeFile(join(outputDir,'inventory.json'),`${JSON.stringify(inventory,null,2)}\n`);
  return inventory;
}
