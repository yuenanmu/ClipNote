export type SourceFormat = 'srt' | 'vtt' | 'txt' | 'md';
export type SourceEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';
export interface SourceSegment {
  segmentId: string;
  order: number;
  text: string;
  startMs?: number;
  endMs?: number;
  range: { startLine: number; endLine: number; startOffset: number; endOffset: number };
}
export interface SourceDocument {
  sourceId: string;
  sourceType: 'file';
  originalPath: string;
  fileName: string;
  format: SourceFormat;
  encoding: SourceEncoding;
  checksum: string;
  rawText: string;
  segments: SourceSegment[];
}
