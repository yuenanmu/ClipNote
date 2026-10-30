import type {SmartSubPreferences} from '../modules/smartsub/preferences.ts';
import type {WorkspaceResult} from '../contracts/workspace.ts';
export function createSmartSubPreferencesHandlers(trusted:(event:unknown)=>boolean,preferences:Pick<SmartSubPreferences,'state'|'save'>){
  const run=async<T>(event:unknown,valid:boolean,work:()=>Promise<T>):Promise<WorkspaceResult<T>>=>{
    if(!trusted(event) || !valid)return {status:'error',error:{code:'SMARTSUB_ERROR',message:'设置参数无效。'}};
    try{return {status:'ok',value:await work()};}catch(error){return {status:'error',error:{code:'SMARTSUB_ERROR',message:error instanceof Error && error.message.length<=160?error.message:'无法读取或保存转写设置。'}};}
  };
  return {state:(event:unknown,...args:unknown[])=>run(event,args.length===0,()=>preferences.state()),save:(event:unknown,...args:unknown[])=>run(event,args.length===1,()=>preferences.save(args[0]))};
}
