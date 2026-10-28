import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { checkedDirectory, digest, exists, readBytes, readJson, writeAtomic, writeNew } from '../storage/io.ts';

type Kind = 'source' | 'notes';
export interface WorkspaceEntry { id: string; name: string; kind: 'directory' | 'file' }
export interface OutputPlan { sourcePath: string; notePath: string; name: string; exists: boolean; checksum?: string }
export class WorkspaceError extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
const validName = (name: string) => typeof name === 'string' && name.length > 0 && name.length <= 200 && !/[\\/:*?"<>|\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && !/^(?:\.|\.\.|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
export class WorkspaceFiles {
  private readonly settings: string;
  private readonly linksPath: string;
  private readonly entries = new Map<string, { kind: Kind; path: string }>();
  constructor(stateDir: string) { this.settings = join(resolve(stateDir), 'workspaces.json'); this.linksPath = join(resolve(stateDir), 'associations.json'); }
  private async associations(): Promise<{ sourcePath: string; notePath: string }[]> {
    if (!await exists(this.linksPath)) return []; const data = await readJson(this.linksPath);
    if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 10000 || data.entries.some((item: any) => !item || typeof item.sourcePath !== 'string' || typeof item.notePath !== 'string' || resolve(item.sourcePath) !== item.sourcePath || resolve(item.notePath) !== item.notePath)) throw new WorkspaceError('SETTINGS_INVALID');
    return data.entries;
  }
  private async updateAssociations(kind: Kind, from: string, to: string) {
    const entries = await this.associations(); let changed = false;
    for (const entry of entries) { const key = kind === 'source' ? 'sourcePath' : 'notePath'; const current = entry[key]; if (current === from || current.startsWith(from + sep)) { entry[key] = to + current.slice(from.length); changed = true; } }
    if (changed) await writeAtomic(this.linksPath, { version: 1, entries });
  }
  private async settingsData(): Promise<Partial<Record<Kind, string>>> {
    if (!await exists(this.settings)) return {};
    const data = await readJson(this.settings); if (data.version !== 1 || (data.source !== undefined && typeof data.source !== 'string') || (data.notes !== undefined && typeof data.notes !== 'string')) throw new WorkspaceError('SETTINGS_INVALID');
    return { source: data.source, notes: data.notes };
  }
  private remember(kind: Kind, path: string, isDirectory: boolean): WorkspaceEntry {
    const old = [...this.entries].find(([, value]) => value.kind === kind && value.path === path)?.[0]; const id = old ?? randomUUID();
    this.entries.set(id, { kind, path }); return { id, name: basename(path), kind: isDirectory ? 'directory' : 'file' };
  }
  async choose(kind: Kind, path: string): Promise<WorkspaceEntry & { path: string }> {
    const absolute = await checkedDirectory(path); const settings = await this.settingsData(); settings[kind] = absolute;
    await writeAtomic(this.settings, { version: 1, ...settings }); for (const [id, entry] of this.entries) if (entry.kind === kind) this.entries.delete(id);
    return { ...this.remember(kind, absolute, true), path: absolute };
  }
  async root(kind: Kind): Promise<(WorkspaceEntry & { path: string }) | undefined> {
    const path = (await this.settingsData())[kind]; if (!path) return undefined;
    const absolute = await checkedDirectory(path); return { ...this.remember(kind, absolute, true), path: absolute };
  }
  private async access(kind: Kind, id: string, directory?: boolean): Promise<string> {
    const root = (await this.settingsData())[kind], entry = this.entries.get(id); if (!root || !entry || entry.kind !== kind) throw new WorkspaceError('INVALID_REQUEST');
    const diff = relative(root, entry.path); if (diff === '..' || diff.startsWith('..' + sep) || resolve(root, diff) !== entry.path) throw new WorkspaceError('INVALID_REQUEST');
    await checkedDirectory(directory ? entry.path : dirname(entry.path)); const stat = await lstat(entry.path);
    if (stat.isSymbolicLink() || (directory === true && !stat.isDirectory()) || (directory === false && !stat.isFile())) throw new WorkspaceError('UNSAFE_PATH');
    return entry.path;
  }
  async list(kind: Kind, id: string, offset = 0): Promise<{ entries: WorkspaceEntry[]; total: number }> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new WorkspaceError('INVALID_REQUEST');
    const parent = await this.access(kind, id, true), children = await readdir(parent, { withFileTypes: true }); const candidates: { name: string; directory: boolean }[] = [];
    for (const child of children) {
      if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile())) continue;
      if (child.isFile() && !(kind === 'notes' ? ['.md'] : ['.md', '.txt', '.srt', '.vtt']).includes(extname(child.name).toLowerCase())) continue;
      candidates.push({ name: child.name, directory: child.isDirectory() });
    }
    candidates.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'zh-CN'));
    return { entries: candidates.slice(offset, offset + 100).map(child => this.remember(kind, join(parent, child.name), child.directory)), total: candidates.length };
  }
  async search(kind: Kind, query: string): Promise<{ entries: (WorkspaceEntry & { relativePath: string })[]; limited: boolean }> {
    if (typeof query !== 'string' || !query.trim() || query.length > 100) throw new WorkspaceError('INVALID_REQUEST');
    const root = await this.root(kind); if (!root) throw new WorkspaceError('INVALID_REQUEST');
    const pending = [root.path], entries: (WorkspaceEntry & { relativePath: string })[] = []; let visited = 0, cursor = 0, limited = false;
    while (cursor < pending.length) {
      const parent = pending[cursor++]; await checkedDirectory(parent); const children = await readdir(parent, { withFileTypes: true });
      for (const child of children) {
        if (++visited > 20000) { limited = true; break; }
        if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile())) continue;
        const path = join(parent, child.name); if (child.isDirectory()) pending.push(path);
        if (child.isFile() && !(kind === 'notes' ? ['.md'] : ['.md','.txt','.srt','.vtt']).includes(extname(child.name).toLowerCase())) continue;
        if (child.name.toLowerCase().includes(query.toLowerCase())) { if (entries.length === 100) { limited = true; break; } entries.push({ ...this.remember(kind, path, child.isDirectory()), relativePath: relative(root.path, path) }); }
      }
      if (limited) break;
    }
    return { entries, limited };
  }
  async createDirectory(kind: Kind, id: string, name: string): Promise<WorkspaceEntry> {
    if (!validName(name)) throw new WorkspaceError('INVALID_NAME'); const parent = await this.access(kind, id, true), path = join(parent, name);
    await mkdir(path); return this.remember(kind, path, true);
  }
  async createNote(id: string, name: string): Promise<WorkspaceEntry> {
    if (!validName(name) || extname(name).toLowerCase() !== '.md') throw new WorkspaceError('INVALID_NAME');
    const parent = await this.access('notes', id, true), path = join(parent, name); await writeNew(path, ''); return this.remember('notes', path, false);
  }
  async move(kind: Kind, id: string, destination: string): Promise<void> {
    const from = await this.access(kind, id), dest = await this.access(kind, destination, true), root = (await this.settingsData())[kind]!;
    if (from === root || dest === from || dest.startsWith(from + sep)) throw new WorkspaceError('INVALID_REQUEST');
    const to = join(dest, basename(from)); if (await exists(to)) throw new WorkspaceError('CONFLICT'); await rename(from, to);
    for (const entry of this.entries.values()) if (entry.kind === kind && (entry.path === from || entry.path.startsWith(from + sep))) entry.path = to + entry.path.slice(from.length);
    await this.updateAssociations(kind, from, to);
  }
  async rename(kind: Kind, id: string, name: string): Promise<void> {
    if (!validName(name)) throw new WorkspaceError('INVALID_NAME');
    const from = await this.access(kind, id), root = (await this.settingsData())[kind]!; if (from === root) throw new WorkspaceError('INVALID_REQUEST');
    const stat = await lstat(from); if (stat.isFile() && kind === 'notes' && extname(name).toLowerCase() !== '.md') throw new WorkspaceError('INVALID_NAME');
    const to = join(dirname(from), name); if (from === to) return; if (await exists(to)) throw new WorkspaceError('CONFLICT'); await rename(from, to);
    for (const entry of this.entries.values()) if (entry.kind === kind && (entry.path === from || entry.path.startsWith(from + sep))) entry.path = to + entry.path.slice(from.length);
    await this.updateAssociations(kind, from, to);
  }
  async filePath(kind: Kind, id: string): Promise<string> { return this.access(kind, id, false); }
  async trash(kind: Kind, id: string, discard: (path: string) => Promise<void>): Promise<void> {
    const path = await this.access(kind, id), root = (await this.settingsData())[kind]!; if (path === root) throw new WorkspaceError('INVALID_REQUEST');
    const links = await this.associations(), key = kind === 'source' ? 'sourcePath' : 'notePath';
    await discard(path); for (const [entryId, entry] of this.entries) if (entry.kind === kind && (entry.path === path || entry.path.startsWith(path + sep))) this.entries.delete(entryId);
    const remaining = links.filter(entry => entry[key] !== path && !entry[key].startsWith(path + sep)); if (remaining.length !== links.length) await writeAtomic(this.linksPath, { version: 1, entries: remaining });
  }
  async readNote(id: string): Promise<{ text: string; checksum: string }> {
    const path = await this.access('notes', id, false), bytes = await readBytes(path, 2 * 1024 * 1024);
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new WorkspaceError('ENCODING'); }
    return { text, checksum: digest(bytes) };
  }
  async previewOutput(sourceId: string, folderId: string): Promise<OutputPlan> {
    const sourcePath = await this.access('source', sourceId, false), folder = await this.access('notes', folderId, true);
    const links = await this.associations(), mapping = links.find(item => item.sourcePath.toLowerCase() === sourcePath.toLowerCase());
    if (mapping && dirname(mapping.notePath).toLowerCase() !== folder.toLowerCase()) throw new WorkspaceError('CONFLICT');
    const name = mapping ? basename(mapping.notePath) : basename(sourcePath, extname(sourcePath)) + '.md'; if (!validName(name)) throw new WorkspaceError('INVALID_NAME');
    const notePath = join(folder, name);
    const occupied = await exists(notePath); if (occupied && (!mapping || mapping.notePath.toLowerCase() !== notePath.toLowerCase())) throw new WorkspaceError('CONFLICT');
    if (mapping && !occupied) throw new WorkspaceError('MISSING');
    const checksum = occupied ? digest(await readBytes(notePath, 2 * 1024 * 1024)) : undefined;
    return { sourcePath, notePath, name, exists: occupied, ...(checksum ? { checksum } : {}) };
  }
  async associate(sourceId: string, noteId: string): Promise<void> {
    const sourcePath = await this.access('source', sourceId, false), notePath = await this.access('notes', noteId, false);
    if (extname(notePath).toLowerCase() !== '.md') throw new WorkspaceError('INVALID_REQUEST');
    const entries = await this.associations();
    if (entries.some(entry => entry.notePath.toLowerCase() === notePath.toLowerCase() && entry.sourcePath.toLowerCase() !== sourcePath.toLowerCase())) throw new WorkspaceError('CONFLICT');
    const existing = entries.find(entry => entry.sourcePath.toLowerCase() === sourcePath.toLowerCase());
    if (existing && existing.notePath.toLowerCase() !== notePath.toLowerCase() && await exists(existing.notePath)) throw new WorkspaceError('CONFLICT');
    if (existing) existing.notePath = notePath; else entries.push({ sourcePath, notePath }); await writeAtomic(this.linksPath, { version: 1, entries });
  }
  async writeOutput(sourceId: string, folderId: string, confirmed: OutputPlan, text: string): Promise<void> {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024) throw new WorkspaceError('INVALID_REQUEST');
    const now = await this.previewOutput(sourceId, folderId);
    if (now.sourcePath !== confirmed.sourcePath || now.notePath !== confirmed.notePath || now.exists !== confirmed.exists || now.checksum !== confirmed.checksum) throw new WorkspaceError('CONFLICT');
    if (confirmed.exists) {
      const temporary = join(dirname(now.notePath), `.clipnote-${randomUUID()}.tmp`); await writeNew(temporary, text);
      try { const check = await this.previewOutput(sourceId, folderId); if (check.checksum !== confirmed.checksum || !check.exists) throw new WorkspaceError('CONFLICT'); await rename(temporary, now.notePath); }
      finally { if (await exists(temporary)) await unlink(temporary); }
    } else await writeNew(now.notePath, text);
    const entries = await this.associations(), existing = entries.find(item => item.sourcePath.toLowerCase() === now.sourcePath.toLowerCase());
    if (!existing) entries.push({ sourcePath: now.sourcePath, notePath: now.notePath }); else existing.notePath = now.notePath;
    await writeAtomic(this.linksPath, { version: 1, entries });
  }
  async saveNote(id: string, checksum: string, text: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(checksum) || typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024) throw new WorkspaceError('INVALID_REQUEST');
    const path = await this.access('notes', id, false), temporary = join(dirname(path), `.clipnote-${randomUUID()}.tmp`); await writeNew(temporary, text);
    try { const current = await readBytes(path, 2 * 1024 * 1024); if (digest(current) !== checksum) throw new WorkspaceError('CONFLICT'); await rename(temporary, path); }
    finally { if (await exists(temporary)) await unlink(temporary); }
  }
}
