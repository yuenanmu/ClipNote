import { parentPort, workerData } from 'node:worker_threads';
import { StorageService } from '../modules/storage/service.ts';
import { archiveMarkdown } from '../modules/storage/format.ts';
import { StorageError } from '../modules/storage/errors.ts';
import { storageFailure } from '../modules/storage/io.ts';
const service = new StorageService(workerData.stateDir);
async function run() {
  const data = workerData.payload;
  switch (workerData.action) {
    case 'state': return service.state();
    case 'choose': return service.chooseDirectory(data.parent);
    case 'save': return service.save(data.snapshot, archiveMarkdown(data.snapshot.document), { kind: 'source-archive' });
    case 'resume': return service.resume(data.draftId);
    case 'open': return service.open(data.sourceId, data.revisionId);
    default: throw new StorageError('INVALID_REQUEST');
  }
}
run().then(value => parentPort?.postMessage({ ok: true, value }), error => { const failure = storageFailure(error); parentPort?.postMessage({ ok: false, code: failure.code, draftId: failure.draftId }); });
