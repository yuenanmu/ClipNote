import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { lstat, mkdir, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { checkedDirectory, digest, exists, isUuid, readBytes, readJson, writeAtomic, writeNew } from '../storage/io.ts';

type Kind = 'source' | 'notes';
import type { WorkspaceEntry,WorkspaceChange } from '../../contracts/workspace.ts';
export type { WorkspaceEntry } from '../../contracts/workspace.ts';
export interface OutputPlan { sourcePath: string; notePath: string; name: string; exists: boolean; checksum?: string; sourceChecksum?: string }
export class WorkspaceError extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
const validName = (name: string) => typeof name === 'string' && name.length > 0 && name.length <= 200 && !/[\\/:*?"<>|\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && !/^(?:\.|\.\.|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
export class WorkspaceFiles {
  private readonly settings: string;
  private readonly linksPath: string;
  private readonly publications: string;
  private readonly writeJson: typeof writeAtomic;
  private readonly entries = new Map<string, { kind: Kind; path: string; external?: boolean }>();
  private readonly locks = new Map<string, number>();
  private readonly listeners=new Set<(change:WorkspaceChange)=>void>();
  private readonly watchers=new Map<string,{kind:Kind;watcher:FSWatcher}>();
  private revision=0;
  private readonly notifications=new Map<Kind,ReturnType<typeof setTimeout>>();
  constructor(stateDir: string, io: { writeJson?: typeof writeAtomic } = {}) { this.settings = join(resolve(stateDir), 'workspaces.json'); this.linksPath = join(resolve(stateDir), 'associations.json'); this.publications = join(resolve(stateDir), 'publications.json'); this.writeJson = io.writeJson ?? writeAtomic; }
  private key(path: string) { return process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path); }
  subscribe(listener:(change:WorkspaceChange)=>void):()=>void{this.listeners.add(listener);return()=>{this.listeners.delete(listener);if(!this.listeners.size)this.dispose();};}
  dispose(){for(const {watcher} of this.watchers.values())watcher.close();this.watchers.clear();for(const timer of this.notifications.values())clearTimeout(timer);this.notifications.clear();}
  private notify(kind:Kind){const pending=this.notifications.get(kind);if(pending)clearTimeout(pending);this.notifications.set(kind,setTimeout(()=>{this.notifications.delete(kind);const change={kind,revision:++this.revision};for(const listener of this.listeners)listener(change);},60));}
  private observe(kind:Kind,path:string){const key=kind+':'+this.key(path);if(!this.listeners.size || this.watchers.has(key))return;
    const watcher=watch(path,{persistent:false},()=>this.notify(kind));watcher.on('error',()=>{watcher.close();this.watchers.delete(key);this.notify(kind);});this.watchers.set(key,{kind,watcher});
  }
  private inside(root: string, path: string) { const diff = relative(root, path); return diff !== '..' && !diff.startsWith('..' + sep) && resolve(root, diff) === resolve(path); }
  private mutable(path: string) { if ([...this.locks.keys()].some(locked => this.key(path) === locked || locked.startsWith(this.key(path) + sep))) throw new WorkspaceError('BUSY'); }
  lockPaths(paths: string[]): () => void { for (const path of paths) { const key = this.key(path); this.locks.set(key, (this.locks.get(key) ?? 0) + 1); } let done = false; return () => { if (done) return; done = true; for (const path of paths) { const key = this.key(path), count = (this.locks.get(key) ?? 1) - 1; if (count) this.locks.set(key,count); else this.locks.delete(key); } }; }
  async isLegacyDirectory(path: string): Promise<boolean> { try { await checkedDirectory(path); const marker = await readJson(join(path,'.clipnote-library.json')); return marker.schemaVersion === 1 && marker.app === 'ClipNote' && isUuid(marker.libraryId); } catch { return false; } }
  async registerSource(path: string): Promise<WorkspaceEntry> {
    const absolute=resolve(path); if (!['.txt','.md','.srt','.vtt'].includes(extname(absolute).toLowerCase())) throw new WorkspaceError('INVALID_REQUEST'); await readBytes(absolute);
    const root=(await this.settingsData()).source; if (root && this.inside(root,absolute)) return this.remember('source',absolute,false);
    const entry=this.remember('source',absolute,false); this.entries.get(entry.id)!.external=true; return entry;
  }
  private async associations(): Promise<{ sourcePath: string; notePath: string }[]> {
    if (!await exists(this.linksPath)) return []; const data = await readJson(this.linksPath);
    if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 10000 || data.entries.some((item: any) => !item || typeof item.sourcePath !== 'string' || typeof item.notePath !== 'string' || resolve(item.sourcePath) !== item.sourcePath || resolve(item.notePath) !== item.notePath)) throw new WorkspaceError('SETTINGS_INVALID');
    return data.entries;
  }
  private async updateAssociations(kind: Kind, from: string, to: string) {
    const entries = await this.associations(); let changed = false;
    for (const entry of entries) { const key = kind === 'source' ? 'sourcePath' : 'notePath'; const current = entry[key]; if (current === from || current.startsWith(from + sep)) { entry[key] = to + current.slice(from.length); changed = true; } }
    if (changed) await this.writeJson(this.linksPath, { version: 1, entries });
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
    const previous=(await this.settingsData())[kind]; if (previous) this.mutable(previous);
    const absolute = await checkedDirectory(path); const settings = await this.settingsData(); settings[kind] = absolute;
    await this.writeJson(this.settings, { version: 1, ...settings }); for (const [id, entry] of this.entries) if (entry.kind === kind && !entry.external) this.entries.delete(id);
    for(const [key,value] of this.watchers)if(value.kind===kind){value.watcher.close();this.watchers.delete(key);}this.notify(kind);
    return { ...this.remember(kind, absolute, true), path: absolute };
  }
  async root(kind: Kind): Promise<(WorkspaceEntry & { path: string }) | undefined> {
    const path = (await this.settingsData())[kind]; if (!path) return undefined;
    const absolute = await checkedDirectory(path); return { ...this.remember(kind, absolute, true), path: absolute };
  }
  private async access(kind: Kind, id: string, directory?: boolean): Promise<string> {
    const root = (await this.settingsData())[kind], entry = this.entries.get(id); if (!entry || entry.kind !== kind) throw new WorkspaceError('INVALID_REQUEST');
    if (!(kind === 'source' && entry.external && directory === false) && (!root || !this.inside(root,entry.path))) throw new WorkspaceError('INVALID_REQUEST');
    await checkedDirectory(directory ? entry.path : dirname(entry.path)); const stat = await lstat(entry.path);
    if (stat.isSymbolicLink() || (directory === true && !stat.isDirectory()) || (directory === false && !stat.isFile())) throw new WorkspaceError('UNSAFE_PATH');
    return entry.path;
  }
  async list(kind: Kind, id: string, offset = 0): Promise<{ entries: WorkspaceEntry[]; total: number }> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new WorkspaceError('INVALID_REQUEST');
    const parent = await this.access(kind, id, true), children = await readdir(parent, { withFileTypes: true }); const candidates: { name: string; directory: boolean }[] = [];
    this.observe(kind,parent);
    for (const child of children) {
      if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile())) continue;
      if (child.isDirectory() && await this.isLegacyDirectory(join(parent,child.name))) continue;
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
        const path = join(parent, child.name); if (child.isDirectory()) { if (await this.isLegacyDirectory(path)) continue; pending.push(path); }
        if (child.isFile() && !(kind === 'notes' ? ['.md'] : ['.md','.txt','.srt','.vtt']).includes(extname(child.name).toLowerCase())) continue;
        if (child.name.toLowerCase().includes(query.toLowerCase())) { if (entries.length === 100) { limited = true; break; } entries.push({ ...this.remember(kind, path, child.isDirectory()), relativePath: relative(root.path, path) }); }
      }
      if (limited) break;
    }
    return { entries, limited };
  }
  async createDirectory(kind: Kind, id: string, name: string): Promise<WorkspaceEntry> {
    if (!validName(name)) throw new WorkspaceError('INVALID_NAME'); const parent = await this.access(kind, id, true), path = join(parent, name);
    this.mutable(path); await mkdir(path); return this.remember(kind, path, true);
  }
  async createNote(id: string, name: string): Promise<WorkspaceEntry> {
    if (!validName(name) || extname(name).toLowerCase() !== '.md') throw new WorkspaceError('INVALID_NAME');
    const parent = await this.access('notes', id, true), path = join(parent, name); this.mutable(path); await writeNew(path, ''); return this.remember('notes', path, false);
  }
  async createImportedNote(id: string, name: string, bytes: Uint8Array): Promise<WorkspaceEntry> {
    if(!validName(name) || extname(name).toLowerCase()!=='.md' || bytes.byteLength>2*1024*1024) throw new WorkspaceError('INVALID_NAME');
    const parent=await this.access('notes',id,true), path=join(parent,name); this.mutable(path); await writeNew(path,bytes); return this.remember('notes',path,false);
  }
  async suggestNoteName(id:string,proposed:string,reserved:Set<string>=new Set()):Promise<string>{
    const parent=await this.access('notes',id,true);let stem=basename(proposed,extname(proposed)).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,160);if(!validName(stem))stem='笔记';
    for(let n=0;n<10000;n++){const name=stem+(n?` (${n+1})`:'')+'.md';if(!reserved.has(name.toLowerCase()) && !await exists(join(parent,name)))return name;}throw new WorkspaceError('CONFLICT');
  }
  async move(kind: Kind, id: string, destination: string): Promise<void> {
    const from = await this.access(kind, id), dest = await this.access(kind, destination, true), root = (await this.settingsData())[kind]!;
    if (from === root || dest === from || dest.startsWith(from + sep)) throw new WorkspaceError('INVALID_REQUEST');
    const to = join(dest, basename(from)); this.mutable(from); this.mutable(to); if (await exists(to)) throw new WorkspaceError('CONFLICT'); await rename(from, to);
    for (const entry of this.entries.values()) if (entry.kind === kind && (entry.path === from || entry.path.startsWith(from + sep))) entry.path = to + entry.path.slice(from.length);
    await this.updateAssociations(kind, from, to);
  }
  async rename(kind: Kind, id: string, name: string): Promise<void> {
    if (!validName(name)) throw new WorkspaceError('INVALID_NAME');
    const from = await this.access(kind, id), root = (await this.settingsData())[kind]!; if (from === root) throw new WorkspaceError('INVALID_REQUEST');
    const stat = await lstat(from); if (stat.isFile() && kind === 'notes' && extname(name).toLowerCase() !== '.md') throw new WorkspaceError('INVALID_NAME');
    const to = join(dirname(from), name); this.mutable(from); this.mutable(to); if (from === to) return; if (await exists(to)) throw new WorkspaceError('CONFLICT'); await rename(from, to);
    for (const entry of this.entries.values()) if (entry.kind === kind && (entry.path === from || entry.path.startsWith(from + sep))) entry.path = to + entry.path.slice(from.length);
    await this.updateAssociations(kind, from, to);
  }
  async filePath(kind: Kind, id: string): Promise<string> { return this.access(kind, id, false); }
  async entry(kind: Kind, id: string): Promise<WorkspaceEntry> { const path=await this.access(kind,id); return this.remember(kind,path,(await lstat(path)).isDirectory()); }
  async moveMany(kind: Kind, ids: string[], destination: string): Promise<{id:string;status:'ok'|'error';code?:string}[]> {
    const results: {id:string;status:'ok'|'error';code?:string}[]=[]; const selected=ids.map(id=>this.entries.get(id)?.path).filter((path):path is string=>!!path);
    for(const id of ids) { try { const path=await this.access(kind,id); if(!selected.some(other=>other!==path && path.startsWith(other+sep))) await this.move(kind,id,destination); results.push({id,status:'ok'}); } catch(error) { results.push({id,status:'error',code:error instanceof WorkspaceError?error.code:(error as NodeJS.ErrnoException).code??'FAILED'}); } } return results;
  }
  async trash(kind: Kind, id: string, discard: (path: string) => Promise<void>): Promise<void> {
    const path = await this.access(kind, id), root = (await this.settingsData())[kind]!; if (path === root) throw new WorkspaceError('INVALID_REQUEST');
    this.mutable(path); const links = await this.associations(), key = kind === 'source' ? 'sourcePath' : 'notePath';
    await discard(path); for (const [entryId, entry] of this.entries) if (entry.kind === kind && (entry.path === path || entry.path.startsWith(path + sep))) this.entries.delete(entryId);
    const remaining = links.filter(entry => entry[key] !== path && !entry[key].startsWith(path + sep)); if (remaining.length !== links.length) await this.writeJson(this.linksPath, { version: 1, entries: remaining });
  }
  async readNote(id: string): Promise<{ text: string; checksum: string }> {
    const path = await this.access('notes', id, false), bytes = await readBytes(path, 2 * 1024 * 1024);
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new WorkspaceError('ENCODING'); }
    return { text, checksum: digest(bytes) };
  }
  async previewOutput(sourceId: string, folderId: string, options?: {name?: string; relocate?: boolean}): Promise<OutputPlan> {
    return this.previewPath(await this.access('source', sourceId, false),folderId,options);
  }
  async previewPath(sourcePath: string, folderId: string, options?: {name?: string; relocate?: boolean}): Promise<OutputPlan> {
    const folder = await this.access('notes', folderId, true);
    const links = await this.associations(), mapping = links.find(item => item.sourcePath.toLowerCase() === sourcePath.toLowerCase());
    const name = options?.name ?? (mapping && !options?.relocate ? basename(mapping.notePath) : basename(sourcePath, extname(sourcePath)) + '.md'); if (!validName(name) || extname(name).toLowerCase()!=='.md') throw new WorkspaceError('INVALID_NAME');
    const notePath = mapping && !options?.relocate ? mapping.notePath : join(folder, name); await this.checkedNotePath(notePath);
    const occupied = await exists(notePath); if (occupied && (!mapping || mapping.notePath.toLowerCase() !== notePath.toLowerCase())) throw new WorkspaceError('CONFLICT');
    if (mapping && !occupied && !options?.relocate) throw new WorkspaceError('MISSING');
    const checksum = occupied ? digest(await readBytes(notePath, 2 * 1024 * 1024)) : undefined;
    return { sourcePath, notePath, name, exists: occupied, ...(await exists(sourcePath)?{sourceChecksum:digest(await readBytes(sourcePath))}:{}), ...(checksum ? { checksum } : {}) };
  }
  private async checkedNotePath(path: string) { const root=(await this.settingsData()).notes; if(!root || !this.inside(root,path) || path===root) throw new WorkspaceError('UNSAFE_PATH'); await checkedDirectory(dirname(path)); }
  async associate(sourceId: string, noteId: string): Promise<void> {
    const sourcePath = await this.access('source', sourceId, false), notePath = await this.access('notes', noteId, false);
    if (extname(notePath).toLowerCase() !== '.md') throw new WorkspaceError('INVALID_REQUEST');
    const entries = await this.associations();
    if (entries.some(entry => entry.notePath.toLowerCase() === notePath.toLowerCase() && entry.sourcePath.toLowerCase() !== sourcePath.toLowerCase())) throw new WorkspaceError('CONFLICT');
    const existing = entries.find(entry => entry.sourcePath.toLowerCase() === sourcePath.toLowerCase());
    if (existing && existing.notePath.toLowerCase() !== notePath.toLowerCase() && await exists(existing.notePath)) throw new WorkspaceError('CONFLICT');
    this.mutable(sourcePath); this.mutable(notePath); if (existing) existing.notePath = notePath; else entries.push({ sourcePath, notePath }); await this.writeJson(this.linksPath, { version: 1, entries });
  }
  async writeOutput(sourceId: string, folderId: string, confirmed: OutputPlan, text: string): Promise<void> {
    await this.access('notes',folderId,true);
    if(await this.access('source',sourceId,false)!==confirmed.sourcePath) throw new WorkspaceError('CONFLICT');
    return this.publish(confirmed,text);
  }
  async canRecoverPublication(plan: OutputPlan,text:string):Promise<boolean>{
    const data=await exists(this.publications)?await readJson(this.publications):{entries:{}},key=digest(plan.sourcePath+'\n'+plan.notePath);
    const owned=data.entries?.[key]?.checksum===digest(text) || (await this.associations()).some(entry=>this.key(entry.sourcePath)===this.key(plan.sourcePath) && this.key(entry.notePath)===this.key(plan.notePath));
    return owned && await exists(plan.notePath) && digest(await readBytes(plan.notePath,2*1024*1024))===digest(text);
  }
  async publish(confirmed: OutputPlan, text: string): Promise<void> {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024) throw new WorkspaceError('INVALID_REQUEST');
    await this.checkedNotePath(confirmed.notePath);
    const outputChecksum=digest(text), key=digest(confirmed.sourcePath+'\n'+confirmed.notePath);
    const data=await exists(this.publications)?await readJson(this.publications):{entries:{}};
    const publications=data.entries as Record<string,{checksum:string}>; if(!publications || typeof publications!=='object' || Array.isArray(publications)) throw new WorkspaceError('SETTINGS_INVALID');
    const recovered=await this.canRecoverPublication(confirmed,text);
    const now=confirmed;
    const check=async()=>{ const occupied=await exists(now.notePath); if(occupied!==confirmed.exists || (occupied && digest(await readBytes(now.notePath,2*1024*1024))!==confirmed.checksum)) throw new WorkspaceError('CONFLICT'); };
    if(!recovered) { await check(); publications[key]={checksum:outputChecksum}; await this.writeJson(this.publications,{version:1,entries:publications});
    if (confirmed.exists) {
      const temporary = join(dirname(now.notePath), `.clipnote-${randomUUID()}.tmp`); await writeNew(temporary, text);
      try { await check(); await rename(temporary, now.notePath); }
      finally { if (await exists(temporary)) await unlink(temporary); }
    } else await writeNew(now.notePath, text); }
    const entries = await this.associations(), existing = entries.find(item => item.sourcePath.toLowerCase() === now.sourcePath.toLowerCase());
    if (!existing) entries.push({ sourcePath: now.sourcePath, notePath: now.notePath }); else existing.notePath = now.notePath;
    await this.writeJson(this.linksPath, { version: 1, entries }); delete publications[key];
    await this.writeJson(this.publications,{version:1,entries:publications});
  }
  async saveNote(id: string, checksum: string, text: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(checksum) || typeof text !== 'string' || Buffer.byteLength(text) > 2 * 1024 * 1024) throw new WorkspaceError('INVALID_REQUEST');
    const path = await this.access('notes', id, false), temporary = join(dirname(path), `.clipnote-${randomUUID()}.tmp`); this.mutable(path); await writeNew(temporary, text);
    try { const current = await readBytes(path, 2 * 1024 * 1024); if (digest(current) !== checksum) throw new WorkspaceError('CONFLICT'); await rename(temporary, path); }
    finally { if (await exists(temporary)) await unlink(temporary); }
  }
}
