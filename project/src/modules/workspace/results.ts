import {randomUUID} from 'node:crypto';
import {readdir,unlink} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {checkedDirectory,exists,isUuid,readJson,writeAtomic} from '../storage/io.ts';
import {WorkspaceError,type OutputPlan,type WorkspaceFiles} from './files.ts';
import type {SavedResult,SavePreview} from '../../contracts/workspace.ts';

interface ResultData {version:1;id:string;createdAt:string;plan:OutputPlan;markdown:string}
export class NoteResults {
  private readonly directory:string;
  private readonly files:WorkspaceFiles;
  private readonly confirmations=new Map<string,{id:string;plan:OutputPlan}>();
  constructor(directory:string,files:WorkspaceFiles){this.directory=resolve(directory);this.files=files;}
  private async read(id:string):Promise<ResultData>{
    if(!isUuid(id))throw new WorkspaceError('INVALID_REQUEST');
    const data=await readJson(join(this.directory,id+'.json'));
    if(data.version!==1 || data.id!==id || typeof data.markdown!=='string' || Buffer.byteLength(data.markdown)>2*1024*1024 || typeof data.createdAt!=='string' || !data.plan || typeof data.plan.sourcePath!=='string' || typeof data.plan.notePath!=='string' || typeof data.plan.name!=='string' || typeof data.plan.exists!=='boolean' || (data.plan.checksum!==undefined && !/^[a-f0-9]{64}$/.test(data.plan.checksum)))throw new WorkspaceError('SETTINGS_INVALID');
    return data as unknown as ResultData;
  }
  async add(plan:OutputPlan,markdown:string):Promise<string>{
    if(typeof markdown!=='string' || Buffer.byteLength(markdown)>2*1024*1024)throw new WorkspaceError('INVALID_REQUEST');
    const id=randomUUID();await checkedDirectory(this.directory,true);await writeAtomic(join(this.directory,id+'.json'),{version:1,id,createdAt:new Date().toISOString(),plan,markdown});return id;
  }
  async list():Promise<SavedResult[]>{
    if(!await exists(this.directory))return [];await checkedDirectory(this.directory);const results:SavedResult[]=[];
    for(const name of (await readdir(this.directory)).slice(0,1000)){if(!name.endsWith('.json') || !isUuid(name.slice(0,-5)))continue;const value=await this.read(name.slice(0,-5));results.push({id:value.id,name:value.plan.name,sourceName:basename(value.plan.sourcePath),createdAt:value.createdAt});}
    return results.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async remove(id:string):Promise<void>{await this.read(id);await unlink(join(this.directory,id+'.json'));}
  async prepare(id:string,folderId?:string,name?:string):Promise<SavePreview>{
    const data=await this.read(id);let plan:OutputPlan;
    if(folderId) plan=await this.files.previewPath(data.plan.sourcePath,folderId,{relocate:true,...(name?{name}:{})});
    else { const root=await this.files.root('notes');if(!root)throw new WorkspaceError('MISSING');
      try {plan=await this.files.previewPath(data.plan.sourcePath,root.id);} catch(error){if(!await this.files.canRecoverPublication(data.plan,data.markdown))throw error;plan=data.plan;} }
    const token=randomUUID();this.confirmations.set(token,{id,plan});while(this.confirmations.size>100)this.confirmations.delete(this.confirmations.keys().next().value!);
    return {token,name:plan.name,path:plan.notePath,overwrite:plan.exists};
  }
  async save(token:string):Promise<void>{
    const selected=this.confirmations.get(token);if(!selected)throw new WorkspaceError('INVALID_REQUEST');const data=await this.read(selected.id);
    const release=this.files.lockPaths([selected.plan.notePath]);try{await this.files.publish(selected.plan,data.markdown);await this.remove(selected.id);this.confirmations.delete(token);}finally{release();}
  }
}
