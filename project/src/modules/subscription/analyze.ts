import type {SourceDocument} from '../../contracts/source.ts';
import type {AnalysisOptions} from '../../contracts/analysis.ts';
import {analyzeSource} from '../analysis/run.ts';
import {createSubscriptionAdapter} from './adapter.ts';
import {planAnalysis} from '../analysis/plan.ts';

type Client=Parameters<typeof createSubscriptionAdapter>[0];
export async function analyzeSubscription(source:SourceDocument,client:Client,profileId:string,model:string,options:AnalysisOptions={}){
 const profile={provider:`subscription:${profileId}`,model,promptVersion:'t08-v1',inputCharBudget:12000,inputByteBudget:32000,outputCharBudget:64000,overlapChars:0,...(options.instructions?{instructions:options.instructions}:{})};
 const chunks=planAnalysis(source,profile).chunks.length;
 const deadlineMs=options.deadlineMs??Math.min(1800000,Math.max(180000,chunks*90000));
 const deadline=new AbortController();
 const timer=setTimeout(()=>deadline.abort(),deadlineMs);
 const signal=options.signal?AbortSignal.any([options.signal,deadline.signal]):deadline.signal;
 const adapter=createSubscriptionAdapter(client,profileId,model,options.onDiagnostic);let failure:unknown;
 const analysis=analyzeSource(source,profile,async request=>{try{return await adapter(request);}catch(error){failure=error;throw error;}},{...options,signal,splitTruncated:true});
 let abortHandler:()=>void=()=>{};
 const aborted=new Promise<never>((_,reject)=>{
  abortHandler=()=>reject(signal.reason);
  signal.addEventListener('abort',abortHandler,{once:true});
  if(signal.aborted)abortHandler();
 });
 try{return await Promise.race([analysis,aborted]);}catch(error){if(!options.signal?.aborted && deadline.signal.aborted)throw Object.assign(new Error('本次资料整理达到时间上限。'),{code:'FILE_TIMEOUT'});if(!options.signal?.aborted && failure)throw failure;throw error;}finally{signal.removeEventListener('abort',abortHandler);clearTimeout(timer);}
}
