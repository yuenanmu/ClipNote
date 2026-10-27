import { Worker } from 'node:worker_threads';
import { SourceImportError } from '../modules/source/errors.ts';
import { StorageError } from '../modules/storage/errors.ts';
import { ReaderError } from '../modules/reader/errors.ts';
export class WorkerTasks {
  private workers = new Set<Worker>();
  run(entry: string, data: unknown, domain: boolean | 'reader' = false): Promise<any> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(entry, { workerData: data }); this.workers.add(worker);
      let settled = false;
      const timer = setTimeout(() => finish(new Error('Worker timed out')), domain === true ? 120_000 : 30_000);
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return; settled = true; clearTimeout(timer); this.workers.delete(worker); void worker.terminate();
        if (error) reject(error); else resolve(value);
      };
      worker.once('message', result => result.ok ? finish(undefined, result.value) : finish(domain === 'reader' ? new ReaderError(result.code) : domain ? new StorageError(result.code, result.draftId) : new SourceImportError(result.code)));
      worker.once('error', error => finish(error));
      worker.once('exit', () => { if (!settled) finish(new Error('Worker exited')); });
    });
  }
  stop(): void { for (const worker of this.workers) void worker.terminate(); this.workers.clear(); }
}
