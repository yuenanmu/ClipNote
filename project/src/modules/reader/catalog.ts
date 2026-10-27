import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { NoteEntry, ReaderTarget } from '../../contracts/reader.ts';
import { checkedDirectory, exists, isUuid, readJson, writeAtomic } from '../storage/io.ts';
import { ReaderError } from './errors.ts';
type Registration = { noteId: string; filePath: string };
const pathKey = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
export class NoteCatalog {
  private file: string;
  constructor(stateDir: string) { this.file = join(stateDir, 'notes.json'); }
  private async read(): Promise<Registration[]> {
    try {
      if (!await exists(this.file)) return [];
      const data = await readJson(this.file);
      if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 1000) throw new Error();
      const ids = new Set<string>(), paths = new Set<string>();
      return data.entries.map((entry: any) => {
        if (!entry || !isUuid(entry.noteId) || typeof entry.filePath !== 'string' || !isAbsolute(entry.filePath) || extname(entry.filePath).toLowerCase() !== '.md' || ids.has(entry.noteId) || paths.has(pathKey(entry.filePath))) throw new Error();
        ids.add(entry.noteId); paths.add(pathKey(entry.filePath));
        return { noteId: entry.noteId, filePath: resolve(entry.filePath) };
      });
    } catch { throw new ReaderError('READER_CATALOG_FAILED'); }
  }
  private async write(entries: Registration[]) {
    try { await writeAtomic(this.file, { version: 1, entries }); }
    catch { throw new ReaderError('READER_CATALOG_FAILED'); }
  }
  async list(): Promise<NoteEntry[]> {
    const entries = await this.read();
    return Promise.all(entries.map(async entry => {
      let available = false;
      try { await checkedDirectory(dirname(entry.filePath)); const stat = await lstat(entry.filePath); available = stat.isFile() && !stat.isSymbolicLink(); } catch { /* Keep unavailable registrations for relinking. */ }
      return { ...entry, fileName: basename(entry.filePath), available };
    }));
  }
  async add(path: string): Promise<Registration> {
    const entries = await this.read(), filePath = resolve(path);
    if (extname(filePath).toLowerCase() !== '.md') throw new ReaderError('READER_INVALID_REQUEST');
    const existing = entries.find(entry => pathKey(entry.filePath) === pathKey(filePath)); if (existing) return existing;
    if (entries.length >= 1000) throw new ReaderError('READER_CATALOG_FULL');
    const entry = { noteId: randomUUID(), filePath }; await this.write([entry, ...entries]); return entry;
  }
  async remove(id: string): Promise<void> {
    const entries = await this.read(); if (!entries.some(entry => entry.noteId === id)) throw new ReaderError('READER_EXPIRED');
    await this.write(entries.filter(entry => entry.noteId !== id));
  }
  async target(id: string): Promise<ReaderTarget> {
    const entry = (await this.read()).find(entry => entry.noteId === id); if (!entry) throw new ReaderError('READER_EXPIRED');
    return { kind: 'file', path: entry.filePath };
  }
  async relink(id: string, path: string): Promise<void> {
    const entries = await this.read(), entry = entries.find(entry => entry.noteId === id);
    if (!entry) throw new ReaderError('READER_EXPIRED');
    if (extname(path).toLowerCase() !== '.md') throw new ReaderError('READER_INVALID_REQUEST');
    if (entries.some(other => other.noteId !== id && pathKey(other.filePath) === pathKey(path))) throw new ReaderError('READER_DUPLICATE');
    entry.filePath = resolve(path); await this.write(entries);
  }
}
