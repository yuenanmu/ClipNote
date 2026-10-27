import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { StorageError } from './errors.ts';
export const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const isSourceId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StorageError('DAMAGED_DATA');
  return value as Record<string, any>;
}
export async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
export async function checkedDirectory(path: string, create = false): Promise<string> {
  const absolute = resolve(path), root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (create && !await exists(current)) { try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new StorageError('UNSAFE_PATH');
  }
  return absolute;
}
export async function readBytes(path: string, limit = 32 * 1024 * 1024): Promise<Buffer> {
  await checkedDirectory(dirname(path));
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new StorageError('UNSAFE_PATH');
  if (stat.size > limit) throw new StorageError('DAMAGED_DATA');
  const file = await open(path, 'r');
  try {
    const parts: Buffer[] = []; let size = 0;
    while (true) {
      const part = Buffer.alloc(64 * 1024), result = await file.read(part, 0, part.length, null);
      if (!result.bytesRead) break;
      size += result.bytesRead; if (size > limit) throw new StorageError('DAMAGED_DATA');
      parts.push(part.subarray(0, result.bytesRead));
    }
    return Buffer.concat(parts, size);
  } finally { await file.close(); }
}
export async function readJson(path: string): Promise<Record<string, any>> {
  try { return record(JSON.parse((await readBytes(path, 4 * 1024 * 1024)).toString('utf8'))); }
  catch (error) { if (error instanceof StorageError) throw error; if (error instanceof SyntaxError) throw new StorageError('DAMAGED_DATA'); throw error; }
}
export async function writeNew(path: string, bytes: Uint8Array | string): Promise<void> {
  await checkedDirectory(dirname(path));
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
export async function writeAtomic(path: string, data: unknown): Promise<void> {
  await checkedDirectory(dirname(path), true);
  if (await exists(path)) {
    const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile()) throw new StorageError('UNSAFE_PATH');
  }
  const temporary = `${path}.tmp-${randomUUID()}`;
  try { await writeNew(temporary, JSON.stringify(data)); await rename(temporary, path); }
  finally { if (await exists(temporary)) await unlink(temporary); }
}
export function storageFailure(error: unknown, draftId?: string): StorageError {
  if (error instanceof StorageError) { if (draftId) error.draftId = draftId; return error; }
  const code = (error as NodeJS.ErrnoException)?.code;
  return new StorageError(code === 'ENOSPC' ? 'STORAGE_FULL' : ['EACCES', 'EPERM', 'EROFS'].includes(code ?? '') ? 'STORAGE_DENIED' : code === 'EEXIST' ? 'COLLISION' : 'SAVE_FAILED', draftId);
}
