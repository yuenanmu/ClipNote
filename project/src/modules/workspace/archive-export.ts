import {randomUUID} from 'node:crypto';
import type {LibraryState} from '../../contracts/storage.ts';
import type {ExportPreview,ExportSelection,FileOperationResult} from '../../contracts/workspace.ts';
import {digest,readBytes} from '../storage/io.ts';
import {WorkspaceError,type WorkspaceFiles} from './files.ts';

export class ArchiveExporter {
  private readonly files:WorkspaceFiles;
  private readonly state:()=>Promise<LibraryState>;
  private readonly items=new Map<string,{path:string;checksum:string}>();
  constructor(files:WorkspaceFiles,state:()=>Promise<LibraryState>){this.files=files;this.state=state;}
  async preview(folderId:string):Promise<ExportPreview>{
    const state=await this.state(),result:ExportPreview={items:[],warnings:[...state.warnings]},seen=new Set<string>(),reserved=new Set<string>();this.items.clear();
    for(const revision of [...state.revisions].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){
      if(revision.kind!=='generated-note' || seen.has(revision.sourceId))continue;
      try {const bytes=await readBytes(revision.notePath,2*1024*1024),id=randomUUID(),name=await this.files.suggestNoteName(folderId,revision.title,reserved);
        reserved.add(name.toLowerCase());this.items.set(id,{path:revision.notePath,checksum:digest(bytes)});result.items.push({id,title:revision.title,name,modified:revision.noteModified,createdAt:revision.createdAt});seen.add(revision.sourceId);
      }catch{result.warnings.push('有归档笔记无法读取，已尝试较早的可读版本。');}
    }
    return result;
  }
  async export(folderId:string,selected:ExportSelection[]):Promise<FileOperationResult[]>{
    const results:FileOperationResult[]=[];
    for(const selection of selected){try{const item=this.items.get(selection.id);if(!item)throw new WorkspaceError('INVALID_REQUEST');const bytes=await readBytes(item.path,2*1024*1024);if(digest(bytes)!==item.checksum)throw new WorkspaceError('CONFLICT');await this.files.createImportedNote(folderId,selection.name,bytes);results.push({id:selection.id,status:'ok'});this.items.delete(selection.id);
      }catch(error){results.push({id:selection.id,status:'error',code:error instanceof WorkspaceError?error.code:(error as NodeJS.ErrnoException).code??'FAILED'});}}
    return results;
  }
}
