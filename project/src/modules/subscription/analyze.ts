import type {SourceDocument} from '../../contracts/source.ts';
import type {AnalysisOptions} from '../../contracts/analysis.ts';
import {analyzeSource} from '../analysis/run.ts';
import {createSubscriptionAdapter} from './adapter.ts';

type Client=Parameters<typeof createSubscriptionAdapter>[0];
export async function analyzeSubscription(source:SourceDocument,client:Client,profileId:string,model:string,options:AnalysisOptions={}){
 const profile={provider:`subscription:${profileId}`,model,promptVersion:'t08-v1',inputCharBudget:12000,inputByteBudget:32000,outputCharBudget:64000,overlapChars:0,...(options.instructions?{instructions:options.instructions}:{})};
 const adapter=createSubscriptionAdapter(client,profileId,model);let failure:unknown;
 try{return await analyzeSource(source,profile,async request=>{try{return await adapter(request);}catch(error){failure=error;throw error;}},{...options,splitTruncated:true});}catch(error){if(!options.signal?.aborted && failure)throw failure;throw error;}
}
