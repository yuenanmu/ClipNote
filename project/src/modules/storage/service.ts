import type { SourceSnapshot } from '../../contracts/source.ts';
import type { LibraryState, OpenedRevision, RevisionMetadata, SavedRevision } from '../../contracts/storage.ts';
import { lstat, mkdir, readdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { MAX_FILE_BYTES, parseSource } from '../source/parser.ts';
import { StorageError } from './errors.ts';
import { checkedDirectory, digest, exists, isSourceId, isUuid, readBytes, readJson, storageFailure, writeAtomic, writeNew } from './io.ts';
import { expectedSourceId, sourceInfo, verifyChecksums, verifyMetadata, verifySnapshot } from './format.ts';
export interface StorageOptions { checkpoint?(stage: string): void | Promise<void>; id?(): string }
interface Draft {
  schemaVersion: 1; draftId: string; sourceId: string; title: string; createdAt: string;
  format: string; checksums: Record<'note' | 'source' | 'info', string>; metadata: RevisionMetadata;
}
export class StorageService {
  private stateDir: string; private options: StorageOptions;
  constructor(stateDir: string, options: StorageOptions = {}) { this.stateDir = resolve(stateDir); this.options = options; }
  private id(): string { const id = this.options.id?.() ?? randomUUID(); if (!isUuid(id)) throw new StorageError('INVALID_REQUEST'); return id; }
  private async selected(): Promise<string | null> {
    const path = join(this.stateDir, 'settings.json');
    if (!await exists(path)) return null;
    const settings = await readJson(path);
    if (settings.schemaVersion !== 1 || typeof settings.directory !== 'string' || resolve(settings.directory) !== settings.directory) throw new StorageError('DAMAGED_DATA');
    return settings.directory;
  }
  private async library(directory: string): Promise<string> {
    await checkedDirectory(directory);
    const marker = await readJson(join(directory, '.clipnote-library.json'));
    if (marker.schemaVersion !== 1 || marker.app !== 'ClipNote' || !isUuid(marker.libraryId)) throw new StorageError('UNOWNED_DIRECTORY');
    return marker.libraryId;
  }
  async chooseDirectory(parent: string): Promise<LibraryState> {
    try {
      const selected = await checkedDirectory(parent);
      const directory = await exists(join(selected, '.clipnote-library.json')) ? selected : join(selected, 'ClipNote');
      if (!await exists(directory)) {
        await mkdir(directory);
        await writeNew(join(directory, '.clipnote-library.json'), JSON.stringify({ schemaVersion: 1, app: 'ClipNote', libraryId: this.id() }));
      } else if (!await exists(join(directory, '.clipnote-library.json'))) throw new StorageError('UNOWNED_DIRECTORY');
      await this.library(directory);
      await checkedDirectory(join(directory, 'items'), true);
      await writeAtomic(join(this.stateDir, 'settings.json'), { schemaVersion: 1, directory });
      return await this.state();
    } catch (error) { throw storageFailure(error); }
  }
  private async readDraft(draftId: string) {
    if (!isUuid(draftId)) throw new StorageError('INVALID_REQUEST');
    const directory = join(this.stateDir, 'drafts', draftId);
    if (!await exists(join(directory, '.prepared')) || await exists(join(directory, '.done'))) throw new StorageError('DAMAGED_DATA');
    if ((await readBytes(join(directory, '.prepared'), 1)).length) throw new StorageError('DAMAGED_DATA');
    const descriptor = await readJson(join(directory, 'draft.json'));
    if (descriptor.schemaVersion !== 1 || descriptor.draftId !== draftId || !isSourceId(descriptor.sourceId) || !['srt', 'vtt', 'txt', 'md'].includes(descriptor.format) || typeof descriptor.createdAt !== 'string' || !Number.isFinite(Date.parse(descriptor.createdAt)) || typeof descriptor.title !== 'string') throw new StorageError('DAMAGED_DATA');
    const checksums = verifyChecksums(descriptor.checksums), metadata = verifyMetadata(descriptor.metadata);
    const note = await readBytes(join(directory, 'note.md')), bytes = await readBytes(join(directory, 'source.bin'), MAX_FILE_BYTES), infoBytes = await readBytes(join(directory, 'source.json'), 128 * 1024);
    if (digest(note) !== checksums.note || digest(bytes) !== checksums.source || digest(infoBytes) !== checksums.info) throw new StorageError('DAMAGED_DATA');
    const info = await readJson(join(directory, 'source.json'));
    if (info.sourceId !== descriptor.sourceId || typeof info.originalPath !== 'string' || info.checksum !== digest(bytes) || info.format !== descriptor.format) throw new StorageError('DAMAGED_DATA');
    const document = parseSource(bytes, info.originalPath);
    if (document.sourceId !== descriptor.sourceId) throw new StorageError('DAMAGED_DATA');
    verifyMetadata(metadata, document);
    return { directory, descriptor: { ...descriptor, checksums, metadata } as Draft, note, bytes, infoBytes };
  }
  private async prepare(snapshotInput: SourceSnapshot, markdown: string, metadataInput: RevisionMetadata): Promise<string> {
    const snapshot = verifySnapshot(snapshotInput), metadata = verifyMetadata(metadataInput, snapshot.document);
    if (typeof markdown !== 'string' || !markdown.trim() || Buffer.byteLength(markdown) > 32 * 1024 * 1024) throw new StorageError('INVALID_REQUEST');
    const draftId = this.id(), directory = join(this.stateDir, 'drafts', draftId);
    await checkedDirectory(join(this.stateDir, 'drafts'), true); await mkdir(directory);
    const info = JSON.stringify(sourceInfo(snapshot.document));
    const descriptor: Draft = { schemaVersion: 1, draftId, sourceId: snapshot.document.sourceId, title: snapshot.document.fileName, createdAt: new Date().toISOString(), format: snapshot.document.format, checksums: { note: digest(markdown), source: digest(snapshot.bytes), info: digest(info) }, metadata };
    await writeNew(join(directory, 'source.bin'), snapshot.bytes);
    await writeNew(join(directory, 'note.md'), markdown);
    await writeNew(join(directory, 'source.json'), info);
    await writeNew(join(directory, 'draft.json'), JSON.stringify(descriptor));
    await writeNew(join(directory, '.prepared'), '');
    return draftId;
  }
  private async finishDraft(directory: string): Promise<void> {
    try {
      await writeNew(join(directory, '.done'), '');
      for (const name of ['source.bin', 'note.md', 'source.json', 'draft.json', '.prepared', 'attempt.json']) {
        const path = join(directory, name);
        if (await exists(path)) { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile()) continue; await unlink(path); }
      }
    } catch { /* A published version remains successful; cleanup is not a second save. */ }
  }
  private async commitDraft(draftId: string): Promise<SavedRevision> {
    const draft = await this.readDraft(draftId), root = await this.selected();
    if (!root) throw new StorageError('DIRECTORY_REQUIRED');
    const libraryId = await this.library(root), { descriptor } = draft;
    const item = join(root, 'items', descriptor.sourceId);
    await checkedDirectory(join(root, 'items'));
    const previousAttempt = join(draft.directory, 'attempt.json');
    if (await exists(previousAttempt)) {
      const attempt = await readJson(previousAttempt);
      if (!isUuid(attempt.revisionId) || !isUuid(attempt.libraryId)) throw new StorageError('DAMAGED_DATA');
      if (attempt.libraryId === libraryId) {
        const previous = join(item, 'revisions', attempt.revisionId, '.committed');
        if (await exists(previous)) {
          const existing = await this.readPublished(root, descriptor.sourceId, attempt.revisionId, false);
          const manifest = await readJson(existing.revision.manifestPath);
          if (manifest.draftId !== draftId) throw new StorageError('DAMAGED_DATA');
          await this.finishDraft(draft.directory); return existing.revision;
        }
      }
    }
    if (!await exists(item)) { await mkdir(item); await writeNew(join(item, 'item.json'), JSON.stringify({ schemaVersion: 1, sourceId: descriptor.sourceId })); }
    await checkedDirectory(item);
    const itemInfo = await readJson(join(item, 'item.json'));
    if (itemInfo.schemaVersion !== 1 || itemInfo.sourceId !== descriptor.sourceId) throw new StorageError('UNOWNED_DIRECTORY');
    const versions = await checkedDirectory(join(item, 'revisions'), true);
    const revisionId = this.id(), directory = join(versions, revisionId);
    await mkdir(directory);
    await writeNew(join(directory, '.owner.json'), JSON.stringify({ libraryId, draftId, sourceId: descriptor.sourceId, revisionId }));
    await writeAtomic(previousAttempt, { libraryId, revisionId });
    const files = { note: 'note.md', source: `source.${descriptor.format}`, info: 'source.json' };
    await writeNew(join(directory, files.source), draft.bytes);
    await this.options.checkpoint?.('after-source');
    await writeNew(join(directory, files.note), draft.note);
    await writeNew(join(directory, files.info), draft.infoBytes);
    const manifest = { ...descriptor, revisionId, libraryId, files };
    await writeNew(join(directory, 'manifest.json'), JSON.stringify(manifest));
    if (digest(await readBytes(join(directory, files.source), MAX_FILE_BYTES)) !== descriptor.checksums.source || digest(await readBytes(join(directory, files.note))) !== descriptor.checksums.note || digest(await readBytes(join(directory, files.info))) !== descriptor.checksums.info) throw new StorageError('DAMAGED_DATA');
    await this.options.checkpoint?.('before-commit');
    await writeNew(join(directory, '.committed'), '');
    await this.options.checkpoint?.('after-commit');
    const saved = (await this.readPublished(root, descriptor.sourceId, revisionId, false)).revision;
    await this.finishDraft(draft.directory); return saved;
  }
  async save(snapshot: SourceSnapshot, markdown: string, metadata: RevisionMetadata): Promise<SavedRevision> {
    let draftId: string | undefined;
    try {
      if (!await this.selected()) throw new StorageError('DIRECTORY_REQUIRED');
      draftId = await this.prepare(snapshot, markdown, metadata);
      await this.options.checkpoint?.('after-prepare');
      return await this.commitDraft(draftId);
    } catch (error) { throw storageFailure(error, draftId); }
  }
  async resume(draftId: string): Promise<SavedRevision> {
    try { return await this.commitDraft(draftId); } catch (error) { throw storageFailure(error, isUuid(draftId) ? draftId : undefined); }
  }
  private async readPublished(root: string, sourceId: string, revisionId: string, includeSnapshot: boolean) {
    if (!isSourceId(sourceId) || !isUuid(revisionId)) throw new StorageError('INVALID_REQUEST');
    const libraryId = await this.library(root), directory = join(root, 'items', sourceId, 'revisions', revisionId);
    await checkedDirectory(directory);
    if ((await readBytes(join(directory, '.committed'), 1)).length) throw new StorageError('DAMAGED_DATA');
    const owner = await readJson(join(directory, '.owner.json')), manifest = await readJson(join(directory, 'manifest.json'));
    if (manifest.schemaVersion !== 1 || manifest.sourceId !== sourceId || manifest.revisionId !== revisionId || manifest.libraryId !== libraryId || !isUuid(manifest.draftId) || owner.draftId !== manifest.draftId || owner.sourceId !== sourceId || owner.revisionId !== revisionId || owner.libraryId !== libraryId || !['srt','vtt','txt','md'].includes(manifest.format) || typeof manifest.title !== 'string' || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) throw new StorageError('DAMAGED_DATA');
    if (manifest.files?.note !== 'note.md' || manifest.files?.source !== `source.${manifest.format}` || manifest.files?.info !== 'source.json') throw new StorageError('DAMAGED_DATA');
    const metadata = verifyMetadata(manifest.metadata), checksums = verifyChecksums(manifest.checksums);
    const notePath = join(directory, 'note.md'), sourcePath = join(directory, manifest.files.source), manifestPath = join(directory, 'manifest.json');
    const note = await readBytes(notePath), bytes = await readBytes(sourcePath, MAX_FILE_BYTES), infoBytes = await readBytes(join(directory, 'source.json'), 128 * 1024);
    if (digest(bytes) !== checksums.source || digest(infoBytes) !== checksums.info || expectedSourceId(manifest.format, checksums.source) !== sourceId) throw new StorageError('DAMAGED_DATA');
    const info = await readJson(join(directory, 'source.json'));
    if (info.sourceId !== sourceId || info.format !== manifest.format || info.checksum !== checksums.source || typeof info.originalPath !== 'string' || info.originalPath.length > 32_768) throw new StorageError('DAMAGED_DATA');
    const revision: SavedRevision = { sourceId, revisionId, title: manifest.title, createdAt: manifest.createdAt, kind: metadata.kind, directory, notePath, sourcePath, manifestPath, noteModified: digest(note) !== checksums.note };
    let snapshot: SourceSnapshot | undefined;
    if (includeSnapshot) { const document = parseSource(bytes, info.originalPath); if (document.sourceId !== sourceId) throw new StorageError('DAMAGED_DATA'); snapshot = { document, bytes }; }
    return { revision, snapshot };
  }
  async open(sourceId: string, revisionId: string): Promise<OpenedRevision> {
    try { if (!isSourceId(sourceId) || !isUuid(revisionId)) throw new StorageError('INVALID_REQUEST'); const root = await this.selected(); if (!root) throw new StorageError('DIRECTORY_REQUIRED'); const result = await this.readPublished(root, sourceId, revisionId, true); return { revision: result.revision, snapshot: result.snapshot! }; }
    catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new StorageError('DAMAGED_DATA'); throw storageFailure(error); }
  }
  async state(): Promise<LibraryState> {
    const result: LibraryState = { directory: null, revisions: [], drafts: [], warnings: [] };
    const draftsPath = join(this.stateDir, 'drafts');
    if (await exists(draftsPath)) {
      try {
        await checkedDirectory(draftsPath);
        for (const name of await readdir(draftsPath)) {
          if (!isUuid(name) || await exists(join(draftsPath, name, '.done'))) continue;
          if (result.drafts.length >= 1000) { result.warnings.push('待恢复草稿较多，本次最多显示1,000份。'); break; }
          try { const draft = await this.readDraft(name); result.drafts.push({ draftId: name, title: draft.descriptor.title, createdAt: draft.descriptor.createdAt }); }
          catch { result.warnings.push('存在不完整或损坏的恢复草稿，未将其报告为成功保存。'); }
        }
      } catch { result.warnings.push('本机恢复区暂时无法读取。'); }
    }
    try {
      result.directory = await this.selected();
      if (result.directory) {
        await this.library(result.directory);
        const items = await checkedDirectory(join(result.directory, 'items'));
        let inspected = 0;
        for (const sourceId of (await readdir(items)).slice(0, 1000)) {
          if (!isSourceId(sourceId)) continue;
          const item = join(items, sourceId);
          try {
            await checkedDirectory(item); const info = await readJson(join(item, 'item.json'));
            if (info.sourceId !== sourceId || info.schemaVersion !== 1) throw new StorageError('DAMAGED_DATA');
            const versions = await checkedDirectory(join(item, 'revisions'));
            for (const revisionId of await readdir(versions)) {
              if (!isUuid(revisionId)) continue;
              if (++inspected > 1000) { result.warnings.push('版本较多，本次最多检查1,000个版本。'); break; }
              try { if (!await exists(join(versions, revisionId, '.committed'))) continue; result.revisions.push((await this.readPublished(result.directory, sourceId, revisionId, false)).revision); }
              catch { result.warnings.push('有版本缺失、损坏或路径不安全，未将其列入可打开版本。'); }
            }
          } catch { result.warnings.push('有来源目录缺失或不安全，已停止读取该目录。'); }
          if (inspected > 1000) break;
        }
      }
    } catch { result.warnings.push('保存目录暂时无法读取，请检查位置或重新选择。'); }
    result.revisions.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.revisionId.localeCompare(a.revisionId));
    return result;
  }
}
