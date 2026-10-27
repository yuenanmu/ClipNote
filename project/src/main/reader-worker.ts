import { parentPort, workerData } from 'node:worker_threads';
import { loadReader } from '../modules/reader/load.ts';
import { ReaderError } from '../modules/reader/errors.ts';
loadReader(workerData.target, workerData.stateDir).then(value => parentPort?.postMessage({ ok: true, value }), error => parentPort?.postMessage({ ok: false, code: error instanceof ReaderError ? error.code : 'READER_UNREADABLE' }));
