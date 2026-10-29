import {inspectSmartSubFiles,type SmartSubInstallation} from '../modules/smartsub/cli.ts';
import type {WorkspaceResult} from '../contracts/workspace.ts';
import type {SmartSubDiscovery} from '../contracts/smartsub.ts';

interface Dependencies {
  isTrustedSender(event:unknown):boolean;
  load():Promise<string|undefined>;
  save(path:string):Promise<void>;
  candidates():string[];
  find(roots:string[]):Promise<SmartSubInstallation|undefined>;
  choose():Promise<string|undefined>;
  openOfficial():Promise<void>;
}
export function createSmartSubDiscoveryHandlers(deps:Dependencies){
  let busy=false;
  const error=(message:string):WorkspaceResult<never>=>({status:'error',error:{code:'SMARTSUB_ERROR',message}});
  const guard=async<T>(event:unknown,args:unknown[],work:()=>Promise<WorkspaceResult<T>>):Promise<WorkspaceResult<T>>=>{
    if(!deps.isTrustedSender(event) || args.length)return error('无法执行 SmartSub 操作。');
    if(busy)return error('正在检查 SmartSub，请稍候。');busy=true;
    try{return await work();}catch{return error('无法检查 SmartSub，请检查安装和权限。');}finally{busy=false;}
  };
  return {
    state:(event:unknown,...args:unknown[])=>guard<SmartSubDiscovery>(event,args,async()=>{
      const saved=await deps.load(),found=await deps.find([...(saved?[saved]:[]),...deps.candidates()]);
      return {status:'ok',value:found?{installed:true,path:found.root}:{installed:false}};
    }),
    choose:(event:unknown,...args:unknown[])=>guard<SmartSubDiscovery>(event,args,async()=>{
      const path=await deps.choose();if(path===undefined)return {status:'cancelled'};
      const found=await deps.find([path]);if(!found){const files=await inspectSmartSubFiles(path);return error(files.program?'该文件夹没有完整的 SmartSub 程序和 CLI：已找到程序，但缺少用于连接的 CLI。':files.cli?'该文件夹没有完整的 SmartSub 程序和 CLI：已找到 CLI，但缺少程序。':'该文件夹没有完整的 SmartSub 程序和 CLI。');}
      await deps.save(found.root);return {status:'ok',value:{installed:true,path:found.root}};
    }),
    openOfficial:(event:unknown,...args:unknown[])=>guard<null>(event,args,async()=>{await deps.openOfficial();return {status:'ok',value:null};}),
  };
}
