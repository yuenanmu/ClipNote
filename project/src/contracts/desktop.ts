import type { SourceDocument } from './source.ts';
import type { SourceErrorCode } from '../modules/source/errors.ts';
import type { LibraryState, SavedRevision } from './storage.ts';
import type { StorageErrorCode } from '../modules/storage/errors.ts';
export type ImportErrorCode = SourceErrorCode | 'IMPORT_BUSY' | 'FORBIDDEN_REQUEST' | 'IMPORT_FAILED';
export type ImportResult = { status: 'imported'; document: SourceDocument } | { status: 'cancelled' } | { status: 'error'; error: { code: ImportErrorCode; message: string } };
export type StorageResult<T> = { status: 'ok'; value: T } | { status: 'cancelled' } | { status: 'error'; error: { code: StorageErrorCode | 'FORBIDDEN_REQUEST' | 'STORAGE_BUSY'; message: string; draftId?: string } };
export interface DesktopApi {
  importSource(): Promise<ImportResult>;
  libraryState(): Promise<StorageResult<LibraryState>>;
  chooseLibrary(): Promise<StorageResult<LibraryState>>;
  saveSource(sourceId: string): Promise<StorageResult<SavedRevision>>;
  resumeSave(draftId: string): Promise<StorageResult<SavedRevision>>;
  openRevision(sourceId: string, revisionId: string): Promise<StorageResult<{ document: SourceDocument; revision: SavedRevision }>>;
}
