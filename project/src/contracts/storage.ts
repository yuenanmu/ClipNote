import type { SourceSnapshot } from './source.ts';
export type RevisionKind = 'source-archive' | 'generated-note';
export interface RevisionMetadata { kind: RevisionKind; provider?: string; model?: string; promptVersion?: string; sourceRefs?: string[] }
export interface SavedRevision {
  sourceId: string; revisionId: string; title: string; createdAt: string; kind: RevisionKind;
  directory: string; notePath: string; sourcePath: string; manifestPath: string; noteModified: boolean;
}
export interface RecoveryDraft { draftId: string; title: string; createdAt: string }
export interface LibraryState { directory: string | null; revisions: SavedRevision[]; drafts: RecoveryDraft[]; warnings: string[] }
export interface OpenedRevision { snapshot: SourceSnapshot; revision: SavedRevision }
