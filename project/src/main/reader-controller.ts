import { randomUUID } from 'node:crypto';
import type { LoadedReader, ReaderDocument, ReaderTarget } from '../contracts/reader.ts';
import { ReaderError } from '../modules/reader/errors.ts';
import type { ReaderErrorCode } from '../modules/reader/errors.ts';
import type { ReaderResult } from '../contracts/desktop.ts';
export type { ReaderResult } from '../contracts/desktop.ts';
import { externalUrl } from '../modules/reader/links.ts';
import { isSourceId, isUuid } from '../modules/storage/io.ts';
export interface ReaderDependencies {
  isTrustedSender(event: unknown): boolean;
  chooseFile(): Promise<string | undefined>;
  load(target: ReaderTarget): Promise<LoadedReader>;
  openFile(path: string): Promise<string>;
  openLink(url: string): Promise<void>;
}
type ReaderAction = 'open' | 'revision' | 'refresh' | 'external' | 'link';
export function createReaderHandlers(dependencies: ReaderDependencies): Record<ReaderAction, (event: unknown, ...args: unknown[]) => Promise<ReaderResult<any>>> {
  const sessions = new Map<string, { target: ReaderTarget; filePath: string; links: Set<string> }>();
  let busy = false;
  const failure = (code: ReaderErrorCode): ReaderResult<never> => { const error = new ReaderError(code); return { status: 'error', error: { code: error.code, message: error.message } }; };
  const handler = (action: ReaderAction) => async (event: unknown, ...args: unknown[]): Promise<ReaderResult<ReaderDocument | null>> => {
    if (!dependencies.isTrustedSender(event)) return failure('READER_INVALID_REQUEST');
    const valid = action === 'open' ? args.length === 0 : action === 'revision' ? args.length === 2 && isSourceId(args[0]) && isUuid(args[1]) : action === 'link' ? args.length === 2 && isUuid(args[0]) && typeof args[1] === 'string' : args.length === 1 && isUuid(args[0]);
    if (!valid) return failure('READER_INVALID_REQUEST');
    if (busy) return failure('READER_BUSY');
    busy = true;
    try {
      const readerId = action === 'open' || action === 'revision' ? randomUUID() : args[0] as string;
      const session = sessions.get(readerId);
      let target: ReaderTarget;
      if (action === 'open') {
        const path = await dependencies.chooseFile(); if (!path) return { status: 'cancelled' };
        target = { kind: 'file', path };
      } else if (action === 'revision') target = { kind: 'revision', sourceId: args[0] as string, revisionId: args[1] as string };
      else {
        if (!session) return failure('READER_EXPIRED');
        if (action === 'external') {
          if (await dependencies.openFile(session.filePath)) return failure('READER_EXTERNAL_FAILED');
          return { status: 'ok', value: null };
        }
        if (action === 'link') {
          const url = externalUrl(args[1] as string);
          if (!url || !session.links.has(url)) return failure('READER_INVALID_REQUEST');
          await dependencies.openLink(url); return { status: 'ok', value: null };
        }
        target = session.target;
      }
      const loaded = await dependencies.load(target);
      const remembered = target.kind === 'revision' ? { ...target, expectedPath: loaded.filePath } : target;
      sessions.delete(readerId); sessions.set(readerId, { target: remembered, filePath: loaded.filePath, links: new Set(loaded.content.links) });
      while (sessions.size > 5) sessions.delete(sessions.keys().next().value!);
      return { status: 'ok', value: { ...loaded, readerId } };
    } catch (error) { return failure(error instanceof ReaderError ? error.code : action === 'link' || action === 'external' ? 'READER_EXTERNAL_FAILED' : 'READER_UNREADABLE'); }
    finally { busy = false; }
  };
  return { open: handler('open'), revision: handler('revision'), refresh: handler('refresh'), external: handler('external'), link: handler('link') };
}
