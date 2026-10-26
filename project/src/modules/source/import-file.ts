import { open } from 'node:fs/promises';
import type { SourceDocument } from '../../contracts/source.ts';
import { MAX_FILE_BYTES, parseSource } from './parser.ts';
import { SourceImportError } from './errors.ts';
export async function importSourceFile(filePath: string): Promise<SourceDocument> {
  try {
    const file = await open(filePath, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new SourceImportError('FILE_UNREADABLE');
      if (stat.size > MAX_FILE_BYTES) throw new SourceImportError('FILE_TOO_LARGE');
      const parts: Buffer[] = [];
      let total = 0;
      while (true) {
        const part = Buffer.alloc(64 * 1024);
        const { bytesRead } = await file.read(part, 0, part.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        if (total > MAX_FILE_BYTES) throw new SourceImportError('FILE_TOO_LARGE');
        parts.push(part.subarray(0, bytesRead));
      }
      return parseSource(Buffer.concat(parts, total), filePath);
    } finally { await file.close(); }
  } catch (error) {
    if (error instanceof SourceImportError) throw error;
    throw new SourceImportError('FILE_UNREADABLE');
  }
}
