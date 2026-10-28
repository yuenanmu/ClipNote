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
    const worker = new Worker(entry, { workerData: { source, credentials, instructions: options.instructions } }); let finished = false;
    const cancel = () => worker.postMessage('cancel'); options.signal?.addEventListener('abort', cancel, { once: true });
    const finish = (error?: Error, value?: AnalysisResult) => { if (finished) return; finished = true; options.signal?.removeEventListener('abort', cancel); void worker.terminate(); error ? reject(error) : resolve(value!); };
    worker.on('message', message => { if (message.type === 'progress') void options.onCheckpoint?.({} as never); else if (message.type === 'metrics') options.onMetrics?.(message.value); else if (message.type === 'result') finish(undefined, message.value); else if (message.type === 'error') finish(message.domain === 'api' ? new ApiError(message.code as ApiErrorCode) : message.domain === 'analysis' ? new AnalysisError(message.code as AnalysisErrorCode) : new Error('Analysis failed')); });
    worker.once('error', () => finish(new Error('Analysis worker failed'))); worker.once('exit', () => { if (!finished) finish(new Error('Analysis worker exited')); });
  });
}
