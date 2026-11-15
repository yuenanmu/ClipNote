import type {AnalysisAdapter} from '../../contracts/analysis.ts';

type Client = {
  getSession(): Promise<{status:string; sharing:boolean; profileId?:string}>;
  streamResponse(options:{model:string; input:string; signal?:AbortSignal}):Promise<{text:string}>;
};
export function createSubscriptionAdapter(client:Client, profileId:string, model:string):AnalysisAdapter {
  const check=async()=>{const session=await client.getSession();if(session.status!=='connected' || !session.sharing || session.profileId!==profileId)throw new Error('订阅账户已变化或不可用，请重新确认。');};
  return async request=>{
    if(request.profile.model!==model)throw new Error('订阅模型已变化，请重新确认。');
    request.signal?.throwIfAborted(); await check(); request.signal?.throwIfAborted();
    const result=await client.streamResponse({model,input:request.chunk.request+(request.repair?'\n上次结果格式错误。请仅输出符合要求的完整 JSON。':'\n请仅输出完整 JSON。'),signal:request.signal});
    request.signal?.throwIfAborted(); await check(); request.signal?.throwIfAborted();
    return {status:'completed',value:result.text};
  };
}
