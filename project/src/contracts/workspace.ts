import type { SourceDocument } from './source.ts';

export type WorkspaceKind = 'source' | 'notes';
export interface WorkspaceEntry { id: string; name: string; kind: 'directory' | 'file'; relativePath?: string }
export interface WorkspaceRoot extends WorkspaceEntry { path: string }
export interface FileOperationResult { id: string; status: 'ok' | 'error'; code?: string }
export type WorkspaceResult<T> = { status: 'ok'; value: T } | { status: 'cancelled' } | { status: 'error'; error: { code: string; message: string } };
export interface WorkspaceActions {
  root: { args: []; value: WorkspaceRoot | undefined };
  choose: { args: []; value: WorkspaceRoot | undefined };
  list: { args: [id: string, offset?: number]; value: { entries: WorkspaceEntry[]; total: number } };
  search: { args: [query: string]; value: { entries: (WorkspaceEntry & { relativePath: string })[]; limited: boolean } };
  entry: { args: [id: string]; value: WorkspaceEntry };
  mkdir: { args: [id: string, name: string]; value: WorkspaceEntry };
  create: { args: [id: string, name: string]; value: WorkspaceEntry };
  rename: { args: [id: string, name: string]; value: void };
  move: { args: [id: string, destination: string]; value: void };
  moveMany: { args: [ids: string[], destination: string]; value: FileOperationResult[] };
  trash: { args: [id: string]; value: void };
  trashMany: { args: [ids: string[]]; value: FileOperationResult[] };
  read: { args: [id: string]; value: { text: string; checksum: string } };
  save: { args: [id: string, checksum: string, text: string]; value: {checksum:string} };
  import: { args: [id: string]; value: SourceDocument };
  associate: { args: [sourceId: string, noteId: string]; value: void };
}
export type WorkspaceAction = keyof WorkspaceActions;
export interface WorkspaceChange { kind: WorkspaceKind; revision: number }
export interface BatchConfig { baseUrl: string; model: string; instructions: string }
export interface BatchItem {
  reused?:boolean; startedAt?:number; finishedAt?:number; progress?:import("./analysis.ts").AnalysisProgress;
  id: string; name: string; outputName: string; outputPath?: string; overwrite: boolean;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; error?: string; canRetrySave?: boolean;
  timing?:{prepareMs:number;apiMs:number;localMs:number;saveMs:number;requests:number};
}
export interface BatchState { status: 'idle' | 'ready' | 'running' | 'done' | 'cancelled'; items: BatchItem[]; baseUrl?: string; model?: string }
export interface SavedResult { id: string; name: string; sourceName: string; createdAt: string }
export interface SavePreview { token: string; name: string; path: string; overwrite: boolean }
export interface ExportItem { id: string; title: string; name: string; modified: boolean; createdAt: string }
export interface ExportPreview { items: ExportItem[]; warnings: string[] }
export interface ExportSelection { id: string; name: string }
