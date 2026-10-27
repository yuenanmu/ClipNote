import { randomUUID } from 'node:crypto';
import type { LoadedReader, ReaderDocument, ReaderTarget } from '../contracts/reader.ts';
import { ReaderError } from '../modules/reader/errors.ts';
import type { ReaderErrorCode } from '../modules/reader/errors.ts';
import type { ReaderResult } from '../contracts/desktop.ts';
export type { ReaderResult } from '../contracts/desktop.ts';
import { externalUrl } from '../modules/reader/links.ts';
import { isSourceId, isUuid } from '../modules/storage/io.ts';
import type { NoteCatalog } from '../modules/reader/catalog.ts';
export interface ReaderDependencies {
  isTrustedSender(event: unknown): boolean;
  chooseFile(): Promise<string | undefined>;
  load(target: ReaderTarget): Promise<LoadedReader>;
  openFile(path: string): Promise<string>;
  openLink(url: string): Promise<void>;
  catalog?: NoteCatalog;
  sourcePath?(sourceId: string): string | undefined;
}
type ReaderAction = 'open' | 'revision' | 'refresh' | 'external' | 'link' | 'noteList' | 'noteAdd' | 'noteOpen' | 'noteRemove' | 'noteRelink' | 'noteSource';
export function createReaderHandlers(dependencies: ReaderDependencies): Record<ReaderAction, (event: unknown, ...args: unknown[]) => Promise<ReaderResult<any>>> {
  const sessions = new Map<string, { target: ReaderTarget; filePath: string; links: Set<string>; noteId?: string }>();
  let busy = false;
  const failure = (code: ReaderErrorCode): ReaderResult<never> => { const error = new ReaderError(code); return { status: 'error', error: { code: error.code, message: error.message } }; };
  const handler = (action: ReaderAction) => async (event: unknown, ...args: unknown[]): Promise<ReaderResult<any>> => {
    if (!dependencies.isTrustedSender(event)) return failure('READER_INVALID_REQUEST');
    const valid = ['open', 'noteList', 'noteAdd'].includes(action) ? args.length === 0 : action === 'noteSource' ? args.length === 1 && isSourceId(args[0]) : action === 'revision' ? args.length === 2 && isSourceId(args[0]) && isUuid(args[1]) : action === 'link' ? args.length === 2 && isUuid(args[0]) && typeof args[1] === 'string' : args.length === 1 && isUuid(args[0]);
    if (!valid) return failure('READER_INVALID_REQUEST');
    if (busy) return failure('READER_BUSY');
    busy = true;
    try {
      const catalog = dependencies.catalog;
      if (action.startsWith('note') && !catalog) return failure('READER_INVALID_REQUEST');
      if (action === 'noteList') return { status: 'ok', value: await catalog!.list() };
      if (action === 'noteRemove') {
        await catalog!.remove(args[0] as string);
        for (const [id, session] of sessions) if (session.noteId === args[0]) sessions.delete(id);
        return { status: 'ok', value: null };
      }
      const readerId = ['open', 'revision', 'noteAdd', 'noteOpen', 'noteRelink', 'noteSource'].includes(action) ? randomUUID() : args[0] as string;
      const session = sessions.get(readerId);
      let target: ReaderTarget, noteId = session?.noteId;
      if (action === 'noteOpen') { noteId = args[0] as string; target = await catalog!.target(noteId); }
      else if (action === 'noteSource') {
        const path = dependencies.sourcePath?.(args[0] as string); if (!path) return failure('READER_INVALID_REQUEST'); target = { kind: 'file', path };
      } else if (action === 'open' || action === 'noteAdd' || action === 'noteRelink') {
        if (action === 'noteRelink') { noteId = args[0] as string; await catalog!.target(noteId); }
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
      if (action === 'noteAdd' || action === 'noteSource') noteId = (await catalog!.add(loaded.filePath)).noteId;
      if (action === 'noteRelink') await catalog!.relink(noteId!, loaded.filePath);
      const remembered = target.kind === 'revision' ? { ...target, expectedPath: loaded.filePath } : target;
      sessions.delete(readerId); sessions.set(readerId, { target: remembered, filePath: loaded.filePath, links: new Set(loaded.content.links), noteId });
      while (sessions.size > 5) sessions.delete(sessions.keys().next().value!);
      return { status: 'ok', value: { ...loaded, readerId, ...(noteId ? { noteId } : {}) } };
    } catch (error) { return failure(error instanceof ReaderError ? error.code : action === 'link' || action === 'external' ? 'READER_EXTERNAL_FAILED' : 'READER_UNREADABLE'); }
    finally { busy = false; }
  };
  return Object.fromEntries((['open', 'revision', 'refresh', 'external', 'link', 'noteList', 'noteAdd', 'noteOpen', 'noteRemove', 'noteRelink', 'noteSource'] as ReaderAction[]).map(action => [action, handler(action)])) as Record<ReaderAction, ReturnType<typeof handler>>;
}
