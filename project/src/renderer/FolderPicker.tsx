import {useEffect,useState} from 'react';
import type {WorkspaceEntry,WorkspaceKind,WorkspaceRoot} from '../contracts/workspace.ts';
import {workspaceValue} from './workspace-api.ts';
import {FileIcon,ToolButton} from './FileIcon.tsx';
export function FolderPicker({kind,onPick,onPickFile,onCancel,title='选择目标文件夹',chooseRoot=false}:{kind:WorkspaceKind;onPick(folder:WorkspaceEntry):void;onPickFile?(file:WorkspaceEntry):void;onCancel():void;title?:string;chooseRoot?:boolean}){
  const [path,setPath]=useState<WorkspaceEntry[]>([]),[folders,setFolders]=useState<WorkspaceEntry[]>([]),[offset,setOffset]=useState(0),[total,setTotal]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [files,setFiles]=useState<WorkspaceEntry[]>([]);
  const load=async(folder:WorkspaceEntry,start=0)=>{const page=await workspaceValue(kind,'list',folder.id,start);setFolders(old=>[...(start?old:[]),...page.entries.filter(item=>item.kind==='directory')]);setFiles(old=>[...(start?old:[]),...page.entries.filter(item=>item.kind==='file')]);setOffset(start+page.entries.length);setTotal(!onPickFile && page.entries.some(item=>item.kind==='file')?start+page.entries.length:page.total);};
  const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'无法打开目录。');}finally{setBusy(false);}};
  useEffect(()=>{void run(async()=>{const root=await workspaceValue(kind,'root');if(root){setPath([root]);await load(root);}});},[kind]);
  const enter=(entry:WorkspaceEntry)=>void run(async()=>{setPath(old=>[...old,entry]);await load(entry);});
  return <div className="file-dialog-shade"><section className="file-dialog folder-picker" role="dialog" aria-modal="true" aria-label={title}><header><strong>{title}</strong><ToolButton label="关闭目录选择" icon="close" onClick={onCancel}/></header>
    <nav aria-label="目标目录路径">{path.map((item,index)=><button key={item.id} disabled={busy} onClick={()=>void run(async()=>{setPath(path.slice(0,index+1));await load(item);})}>{item.name}{index<path.length-1?' /':''}</button>)}</nav>
    {!path.length && <p>请先打开{kind==='notes'?'笔记':'资料'}文件夹。</p>}
    {chooseRoot && <button disabled={busy} onClick={()=>void run(async()=>{const root=await workspaceValue(kind,'choose') as WorkspaceRoot|undefined;if(root){setPath([root]);await load(root);}})}>打开{kind==='notes'?'笔记':'资料'}文件夹</button>}
    <div className="folder-picker-list">{folders.map(folder=><button key={folder.id} disabled={busy} onClick={()=>enter(folder)}><FileIcon name="folder"/>{folder.name}</button>)}{onPickFile && files.map(file=><button key={file.id} disabled={busy} onClick={()=>onPickFile(file)}><FileIcon/>{file.name}</button>)}{path.length>0 && !folders.length && (!onPickFile || !files.length) && <p>{onPickFile?'此目录没有笔记。':'此目录没有子文件夹，可以直接选用。'}</p>}{offset<total && <button disabled={busy} onClick={()=>void run(()=>load(path.at(-1)!,offset))}>加载更多</button>}</div>
    {error && <p role="alert">{error}</p>}<footer><button className="secondary" onClick={onCancel}>取消</button>{!onPickFile && <button className="primary" disabled={busy || !path.length} onClick={()=>onPick(path.at(-1)!)}>使用此文件夹</button>}</footer>
  </section></div>;
}
