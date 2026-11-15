import {readFile,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,sep} from 'node:path';

function inside(root,path) {
  const rel=relative(root,path);
  return rel!=='' && !isAbsolute(rel) && rel!=='..' && !rel.startsWith(`..${sep}`);
}

// Callers supply only dependency files known to contribute to build output.
export async function collectEmbeddedPackages({projectRoot,files}) {
  const root=await realpath(projectRoot),modules=await realpath(join(root,'node_modules'));
  if (!inside(root,modules)) throw new Error('Invalid dependency path');
  const found=new Map();
  for (const item of files) {
    if (!['main','renderer'].includes(item.group)) throw new Error('Invalid group');
    const file=await realpath(item.path);
    if (!inside(modules,file)) throw new Error('Invalid dependency path');
    let dir=dirname(file),meta;
    while (inside(modules,dir)) {
      try { meta=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));break; }
      catch (error) { if (error.code!=='ENOENT') throw error; }
      dir=dirname(dir);
    }
    if (!meta || typeof meta.name!=='string' || typeof meta.version!=='string') throw new Error('Missing package metadata');
    const key=dir,row=found.get(key)??{name:meta.name,version:meta.version,path:dir,groups:new Set()};
    row.groups.add(item.group);found.set(key,row);
  }
  return [...found.values()].map(row=>({...row,groups:[...row.groups].sort()})).sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
}
