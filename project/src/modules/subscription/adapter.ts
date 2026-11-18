import type {AnalysisAdapter} from '../../contracts/analysis.ts';
import {createDiagnosticEmitter} from '../analysis/diagnostic-emitter.ts';

type Client = {
  getSession(): Promise<{status:string; sharing:boolean; profileId?:string}>;
  streamResponse(options:{model:string; input:string; signal?:AbortSignal; onHeaders?():void; onDelta?(text:string):void}):Promise<{text:string}>;
};
export function createSubscriptionAdapter(client:Client, profileId:string, model:string, onDiagnostic?:(phase:'request'|'headers'|'first_text'|'last_text'|'received',ageMs?:number)=>void):AnalysisAdapter {
  const check=async()=>{const session=await client.getSession();if(session.status!=='connected' || !session.sharing || session.profileId!==profileId)throw new Error('订阅账户已变化或不可用，请重新确认。');};
  return async request=>{
    const diagnostic=createDiagnosticEmitter(onDiagnostic);
    if(request.profile.model!==model)throw new Error('订阅模型已变化，请重新确认。');
    request.signal?.throwIfAborted(); await check(); request.signal?.throwIfAborted();
    let receivedText=false;
    diagnostic('request');
    let result:{text:string};
    try { result=await client.streamResponse({model,input:request.chunk.request+(request.repair?'\n上次结果格式错误。请仅输出符合要求的完整 JSON。':'\n请仅输出完整 JSON。'),signal:request.signal,onHeaders:()=>{if(!request.signal?.aborted)diagnostic('headers');},onDelta:text=>{
      if(!text.trim() || request.signal?.aborted)return;
      if(!receivedText){receivedText=true;diagnostic('first_text');}
      diagnostic('last_text');
    }}); } finally { diagnostic.flush(); }
    request.signal?.throwIfAborted();
    diagnostic('received');
    await check(); request.signal?.throwIfAborted();
    return {status:'completed',value:result.text};
  };
}
