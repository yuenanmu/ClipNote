import type { SourceDocument } from './source.ts';
import type { SourceErrorCode } from '../modules/source/errors.ts';
export type ImportErrorCode = SourceErrorCode | 'IMPORT_BUSY' | 'FORBIDDEN_REQUEST' | 'IMPORT_FAILED';
export type ImportResult = { status: 'imported'; document: SourceDocument } | { status: 'cancelled' } | { status: 'error'; error: { code: ImportErrorCode; message: string } };
export interface DesktopApi { importSource(): Promise<ImportResult> }
