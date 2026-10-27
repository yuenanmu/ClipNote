import type { LoadedReader, ReaderTarget } from '../../contracts/reader.ts';
import { lstat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { decodeSourceBytes } from '../source/parser.ts';
import { checkedDirectory, digest, readBytes } from '../storage/io.ts';
import { dirname } from 'node:path';
import { StorageService } from '../storage/service.ts';
import { ReaderError } from './errors.ts';
import { MAX_READER_BYTES, parseMarkdown } from './parse.ts';
export async function loadReader(target: ReaderTarget, stateDir: string): Promise<LoadedReader> {
  try {
    let path: string, archive: LoadedReader['archive'], noteModified: boolean | undefined;
    if (target.kind === 'file') path = resolve(target.path);
    else {
      const opened = await new StorageService(stateDir).open(target.sourceId, target.revisionId);
      path = opened.revision.notePath;
      if (target.expectedPath && resolve(target.expectedPath) !== path) throw new ReaderError('READER_UNREADABLE');
      archive = { sourceId: target.sourceId, revisionId: target.revisionId, sourceFile: basename(opened.revision.sourcePath), segmentIds: opened.snapshot.document.segments.map(item => item.segmentId) };
      noteModified = opened.revision.noteModified;
    }
    if (extname(path).toLowerCase() !== '.md') throw new ReaderError('READER_INVALID_REQUEST');
    await checkedDirectory(dirname(path));
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new ReaderError('READER_UNREADABLE');
    if (stat.size > MAX_READER_BYTES) throw new ReaderError('READER_TOO_LARGE');
    const bytes = await readBytes(path, MAX_READER_BYTES);
    let decoded;
    try { decoded = decodeSourceBytes(bytes); } catch { throw new ReaderError('READER_ENCODING'); }
    return { fileName: basename(path), filePath: path, checksum: digest(bytes), encoding: decoded.encoding, content: parseMarkdown(decoded.rawText), ...(archive ? { archive, noteModified } : {}) };
  } catch (error) { throw error instanceof ReaderError ? error : new ReaderError('READER_UNREADABLE'); }
}
