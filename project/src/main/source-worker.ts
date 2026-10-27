import { parentPort, workerData } from 'node:worker_threads';
import { importSourceSnapshot } from '../modules/source/import-file.ts';
import { SourceImportError } from '../modules/source/errors.ts';
importSourceSnapshot(workerData.filePath).then(
  snapshot => { const bytes = Uint8Array.from(snapshot.bytes); parentPort?.postMessage({ ok: true, value: { document: snapshot.document, bytes } }, [bytes.buffer]); },
  error => parentPort?.postMessage({ ok: false, code: error instanceof SourceImportError ? error.code : 'FILE_UNREADABLE' }),
);
