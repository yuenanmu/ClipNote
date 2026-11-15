import { parentPort, workerData } from 'node:worker_threads';
import { analyzeWithApi } from '../modules/api/provider.ts';
import { AnalysisError } from '../modules/analysis/errors.ts';
import { ApiError } from '../modules/api/errors.ts';
const controller = new AbortController();
parentPort?.on('message', message => { if (message === 'cancel') controller.abort(); });
analyzeWithApi(workerData.source, workerData.credentials, { signal: controller.signal, checkpoints:workerData.checkpoints, onProgress:value=>parentPort?.postMessage({type:'activity',value}), instructions: workerData.instructions, onMetrics: value => { parentPort?.postMessage({ type: 'metrics', value }); }, onCheckpoint: value => { parentPort?.postMessage({ type: 'progress',value }); } }).then(
  value => parentPort?.postMessage({ type: 'result', value }),
  error => parentPort?.postMessage({ type: 'error', checkpoints:error?.checkpoints, domain: error instanceof ApiError ? 'api' : error instanceof AnalysisError ? 'analysis' : 'unknown', code: error instanceof ApiError || error instanceof AnalysisError ? error.code : undefined }),
);
