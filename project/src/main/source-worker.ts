import { parentPort, workerData } from 'node:worker_threads';
import { importSourceFile } from '../modules/source/import-file.ts';
import { SourceImportError } from '../modules/source/errors.ts';
importSourceFile(workerData.filePath).then(
  document => parentPort?.postMessage({ ok: true, document }),
  error => parentPort?.postMessage({ ok: false, code: error instanceof SourceImportError ? error.code : 'FILE_UNREADABLE' }),
);
