import {isUuid} from '../modules/storage/io.ts';
import type {SmartSubTaskView,SmartSubSource,SmartSubReadiness,SmartSubTranscriptionReadiness} from '../contracts/smartsub.ts';
import type {WorkspaceResult} from '../contracts/workspace.ts';

interface Dependencies {
  isTrustedSender(event:unknown):boolean;
  readiness():Promise<SmartSubReadiness>;
  prepare(url:string):Promise<{requestId:string}>;
  submit(id:string,url:string):Promise<SmartSubTaskView>;
  refresh(id:string):Promise<SmartSubTaskView>;
  cancel(id:string):Promise<SmartSubTaskView>;
  importSubtitle(id:string,index:number):Promise<SmartSubSource>;
  transcriptionReady(id:string):Promise<SmartSubTranscriptionReadiness>;
  transcribe(id:string,engine:string,model:string):Promise<SmartSubTaskView>;
  transcriptionRetry(id:string,engine:string,model:string):Promise<SmartSubTaskView>;
  transcriptionRefresh(id:string):Promise<SmartSubTaskView>;
  transcriptionCancel(id:string):Promise<SmartSubTaskView>;
  transcriptionImport(id:string,index:number):Promise<SmartSubSource>;
}
export function createSmartSubTaskHandlers(deps:Dependencies){
  const fail=(message:string):WorkspaceResult<never>=>({status:'error',error:{code:'SMARTSUB_ERROR',message}});
  const call=async<T>(event:unknown,args:unknown[],valid:boolean,work:()=>Promise<T>):Promise<WorkspaceResult<T>>=>{
    if(!deps.isTrustedSender(event) || !valid)return fail('任务参数无效。');
    try{return {status:'ok',value:await work()};}catch(error){return fail(error instanceof Error && error.message.length<=160?error.message:'SmartSub 操作失败，请重试。');}
  };
  const url=(value:unknown):value is string=>typeof value==='string' && value.length<=4096;
  return {
    readiness:(event:unknown,...args:unknown[])=>call(event,args,args.length===0,()=>deps.readiness()),
    prepare:(event:unknown,...args:unknown[])=>call(event,args,args.length===1 && url(args[0]),()=>deps.prepare(args[0] as string)),
    submit:(event:unknown,...args:unknown[])=>call(event,args,args.length===2 && isUuid(args[0]) && url(args[1]),()=>deps.submit(args[0] as string,args[1] as string)),
    refresh:(event:unknown,...args:unknown[])=>call(event,args,args.length===1 && isUuid(args[0]),()=>deps.refresh(args[0] as string)),
    cancel:(event:unknown,...args:unknown[])=>call(event,args,args.length===1 && isUuid(args[0]),()=>deps.cancel(args[0] as string)),
    importSubtitle:(event:unknown,...args:unknown[])=>call(event,args,args.length===2 && isUuid(args[0]) && Number.isSafeInteger(args[1]) && (args[1] as number)>=0 && (args[1] as number)<1000,()=>deps.importSubtitle(args[0] as string,args[1] as number)),
    transcriptionReady:(event:unknown,...args:unknown[])=>call(event,args,args.length===1 && isUuid(args[0]),()=>deps.transcriptionReady(args[0] as string)),
    transcribe:(event:unknown,...args:unknown[])=>call(event,args,args.length===3 && isUuid(args[0]) && typeof args[1]==='string' && args[1].length<100 && typeof args[2]==='string' && args[2].length<200,()=>deps.transcribe(args[0] as string,args[1] as string,args[2] as string)),
    transcriptionRetry:(event:unknown,...args:unknown[])=>call(event,args,args.length===3 && isUuid(args[0]) && typeof args[1]==='string' && args[1].length<100 && typeof args[2]==='string' && args[2].length<200,()=>deps.transcriptionRetry(args[0] as string,args[1] as string,args[2] as string)),
    transcriptionRefresh:(event:unknown,...args:unknown[])=>call(event,args,args.length===1 && isUuid(args[0]),()=>deps.transcriptionRefresh(args[0] as string)),
    transcriptionCancel:(event:unknown,...args:unknown[])=>call(event,args,args.length===1 && isUuid(args[0]),()=>deps.transcriptionCancel(args[0] as string)),
    transcriptionImport:(event:unknown,...args:unknown[])=>call(event,args,args.length===2 && isUuid(args[0]) && Number.isSafeInteger(args[1]) && (args[1] as number)>=0 && (args[1] as number)<1000,()=>deps.transcriptionImport(args[0] as string,args[1] as number)),
  };
}
