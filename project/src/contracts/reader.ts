import type { Root } from 'mdast';
declare module 'mdast' {
  interface Toml extends Literal { type: 'toml' }
  interface RootContentMap { toml: Toml }
}
export interface ReaderHeading { id: string; title: string; depth: number; blockIndex: number; children: ReaderHeading[] }
export interface ReaderContent { root: Root; headings: ReaderHeading[]; links: string[] }
export interface ReaderArchive { sourceId: string; revisionId: string; sourceFile: string; segmentIds: string[] }
export interface ReaderDocument {
  readerId: string; fileName: string; filePath: string; encoding: string; checksum: string;
  content: ReaderContent; archive?: ReaderArchive; noteModified?: boolean;
}
export type ReaderTarget = { kind: 'file'; path: string } | { kind: 'revision'; sourceId: string; revisionId: string; expectedPath?: string };
export type LoadedReader = Omit<ReaderDocument, 'readerId'>;
export type ReaderLink = { kind: 'anchor'; id: string } | { kind: 'external'; url: string } | { kind: 'source'; segmentId?: string } | { kind: 'blocked' };
