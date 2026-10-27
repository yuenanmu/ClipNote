import type { SourceDocument } from './source.ts';
export interface SourceRef { segmentId: string; startOffset: number; endOffset: number }
export interface AnalysisProfile {
  provider: string; model: string; promptVersion: string;
  inputCharBudget: number; outputCharBudget: number; overlapChars: number; inputByteBudget?: number;
}
export interface AnalysisChunk { chunkId: string; index: number; core: SourceRef[]; context: SourceRef[]; request: string }
export interface ChunkPlan { planId: string; sourceId: string; profile: AnalysisProfile; chunks: AnalysisChunk[] }
export type NoteKind = 'summary' | 'point' | 'support' | 'example' | 'limitation';
export interface NoteItem { kind: NoteKind; text: string; refs: SourceRef[]; children: NoteItem[] }
export interface NoteSection { heading: string; refs: SourceRef[]; items: NoteItem[] }
export interface NoteOutline { title: string; sections: NoteSection[] }
export interface ChunkCheckpoint { planId: string; chunkId: string; outline: NoteOutline }
export interface GenerationAttempt { provider: string; model: string; promptVersion: string; planId: string }
export interface AnalysisRequest { chunk: AnalysisChunk; profile: AnalysisProfile; signal?: AbortSignal; repair: boolean }
export interface ModelResult { status: 'completed' | 'truncated'; value: unknown }
export type AnalysisAdapter = (request: AnalysisRequest) => Promise<ModelResult>;
export interface AnalysisResult { outline: NoteOutline; markdown: string; sourceRefs: string[]; attempt: GenerationAttempt; checkpoints: ChunkCheckpoint[] }
export interface AnalysisOptions { signal?: AbortSignal; checkpoints?: ChunkCheckpoint[]; onCheckpoint?(checkpoint: ChunkCheckpoint): void | Promise<void> }
export type AnalysisSource = SourceDocument;
