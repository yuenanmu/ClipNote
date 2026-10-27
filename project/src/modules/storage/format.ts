import type { SourceDocument, SourceSnapshot } from '../../contracts/source.ts';
import type { RevisionMetadata } from '../../contracts/storage.ts';
import { parseSource, MAX_FILE_BYTES } from '../source/parser.ts';
import { StorageError } from './errors.ts';
import { digest, record } from './io.ts';
export function verifySnapshot(snapshot: SourceSnapshot): SourceSnapshot {
  if (!(snapshot?.bytes instanceof Uint8Array) || snapshot.bytes.byteLength > MAX_FILE_BYTES || typeof snapshot.document?.originalPath !== 'string' || snapshot.document.originalPath.length > 32_768) throw new StorageError('INVALID_REQUEST');
  const bytes = Uint8Array.from(snapshot.bytes);
  let document: SourceDocument;
  try { document = parseSource(bytes, snapshot.document.originalPath); } catch { throw new StorageError('INVALID_REQUEST'); }
  if (document.sourceId !== snapshot.document.sourceId || document.checksum !== snapshot.document.checksum) throw new StorageError('INVALID_REQUEST');
  return { bytes, document };
}
export function verifyMetadata(value: RevisionMetadata, source?: SourceDocument): RevisionMetadata {
  const data = record(value), keys = ['kind', 'provider', 'model', 'promptVersion', 'sourceRefs'];
  if (Object.keys(data).some(key => !keys.includes(key)) || !['source-archive', 'generated-note'].includes(data.kind)) throw new StorageError('INVALID_REQUEST');
  for (const key of ['provider', 'model', 'promptVersion']) if (data[key] !== undefined && (typeof data[key] !== 'string' || data[key].length > 200)) throw new StorageError('INVALID_REQUEST');
  if (data.sourceRefs !== undefined) {
    if (!Array.isArray(data.sourceRefs) || data.sourceRefs.length > 20_000 || data.sourceRefs.some((item: unknown) => typeof item !== 'string' || item.length > 100)) throw new StorageError('INVALID_REQUEST');
    if (source) { const ids = new Set(source.segments.map(item => item.segmentId)); if (data.sourceRefs.some((id: string) => !ids.has(id))) throw new StorageError('INVALID_REQUEST'); }
  }
  return JSON.parse(JSON.stringify(data));
}
export function sourceInfo(document: SourceDocument) {
  const { sourceId, originalPath, fileName, format, encoding, checksum } = document;
  return { schemaVersion: 1, sourceId, originalPath, fileName, format, encoding, checksum };
}
export function archiveMarkdown(document: SourceDocument): string {
  if (document.format === 'md') return document.rawText;
  let longest = 2;
  for (const match of document.rawText.matchAll(/~+/g)) longest = Math.max(longest, match[0].length);
  const fence = '~'.repeat(longest + 1);
  return `# 来源归档\n\n> 原文归档，尚未进行 AI 整理。\n\n[原始文件](source.${document.format})\n\n${fence}text\n${document.rawText}\n${fence}\n`;
}
export function verifyChecksums(data: unknown): Record<'note' | 'source' | 'info', string> {
  const checksums = record(data);
  if (['note', 'source', 'info'].some(key => typeof checksums[key] !== 'string' || !/^[a-f0-9]{64}$/.test(checksums[key]))) throw new StorageError('DAMAGED_DATA');
  return checksums as Record<'note' | 'source' | 'info', string>;
}
export function expectedSourceId(format: string, checksum: string): string { return digest(`${format}\0${checksum}`); }
