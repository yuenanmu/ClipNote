import { Worker } from 'node:worker_threads';
import type { SourceDocument } from '../contracts/source.ts';
import type { ApiConfigInput, ApiErrorCode } from '../contracts/api.ts';
import type { AnalysisErrorCode } from '../modules/analysis/errors.ts';
import type { AnalysisOptions, AnalysisResult } from '../contracts/analysis.ts';
import { ApiError } from '../modules/api/errors.ts';
import { AnalysisError } from '../modules/analysis/errors.ts';
export function runAnalysisWorker(entry: string, source: SourceDocument, credentials: ApiConfigInput, options: AnalysisOptions): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new AnalysisError('CANCELLED')); return; }
    const worker = new Worker(entry, { workerData: { source, credentials, instructions: options.instructions,checkpoints:options.checkpoints } }); let finished = false;const completed=new Map<string,import('../contracts/analysis.ts').ChunkCheckpoint>();
    for(const cp of options.checkpoints??[])completed.set(cp.chunkId,cp);
    const cancel = () => finish(new AnalysisError('CANCELLED',[...completed.values()])); options.signal?.addEventListener('abort', cancel, { once: true });
    const finish = (error?: Error, value?: AnalysisResult) => { if (finished) return; finished = true;if(error && !('checkpoints' in error))Object.assign(error,{checkpoints:[...completed.values()]}); options.signal?.removeEventListener('abort', cancel); void worker.terminate(); error ? reject(error) : resolve(value!); };
    worker.on('message', message => { if(finished)return;if (message.type === 'activity') options.onProgress?.(message.value); else if (message.type === 'progress' && message.value) {completed.set(message.value.chunkId,message.value);void options.onCheckpoint?.(message.value);} else if (message.type === 'metrics') options.onMetrics?.(message.value); else if (message.type === 'result') finish(undefined, message.value); else if (message.type === 'error') finish(message.domain === 'api' ? new ApiError(message.code as ApiErrorCode) : message.domain === 'analysis' ? new AnalysisError(message.code as AnalysisErrorCode,message.checkpoints??[...completed.values()]) : new Error('Analysis failed')); });
    worker.once('error', () => finish(new Error('Analysis worker failed'))); worker.once('exit', () => { if (!finished) finish(new Error('Analysis worker exited')); });
  });
}
