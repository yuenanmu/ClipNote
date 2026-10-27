import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import type { SourceDocument, SourceEncoding, SourceFormat, SourceSegment } from '../../contracts/source.ts';
import { SourceImportError } from './errors.ts';
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_SEGMENTS = 20_000;

export function decodeSourceBytes(bytes: Uint8Array): { rawText: string; encoding: SourceEncoding } {
  let encodings: SourceEncoding[] = ['utf-8', 'gb18030'];
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encodings = ['utf-16le'];
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encodings = ['utf-16be'];
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encodings = ['utf-8'];
  for (const encoding of encodings) {
    try {
      const rawText = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      if (rawText.includes('\0')) throw new Error('binary data');
      return { rawText, encoding };
    } catch { /* Try only the explicitly supported decoders. */ }
  }
  throw new SourceImportError('INVALID_ENCODING');
}

interface Line { text: string; number: number; start: number; end: number }
function* sourceLines(rawText: string): Generator<Line> {
  const breaks = /\r\n|\r|\n/g;
  let start = 0, number = 1;
  for (const match of rawText.matchAll(breaks)) {
    yield { text: rawText.slice(start, match.index), number: number++, start, end: match.index };
    start = match.index + match[0].length;
  }
  yield { text: rawText.slice(start), number, start, end: rawText.length };
}

interface Block { first: Line; second?: Line; third?: Line; last: Line; timingCount: number; headerMetadataValid: boolean }
function* groups(lines: Iterable<Line>, inspectTiming: boolean): Generator<Block> {
  let block: Block | undefined;
  for (const line of lines) {
    if (line.text.trim()) {
      if (!block) block = { first: line, last: line, timingCount: 0, headerMetadataValid: true };
      else {
        if (!block.second) block.second = line;
        else if (!block.third) block.third = line;
        block.last = line;
        if (block.first.text.startsWith('WEBVTT') && !/^[A-Za-z][\w-]*\s*[:=]/.test(line.text)) block.headerMetadataValid = false;
      }
      if (inspectTiming && /^\d{2,}:(?:\d{2}:)?\d{2}[.,]\d{1,3}[ \t]+-->/.test(line.text.trim())) block.timingCount++;
    } else if (block) { yield block; block = undefined; }
  }
  if (block) yield block;
}

function timestamp(value: string, format: SourceFormat): number {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(value);
  if (!match || (format === 'srt' && match[1] === undefined) || (format === 'vtt' && value.includes(','))) throw new SourceImportError('INVALID_SUBTITLE');
  const hours = Number(match[1] ?? 0), minutes = Number(match[2]), seconds = Number(match[3]);
  const result = ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(match[4].padEnd(3, '0'));
  if (minutes > 59 || seconds > 59 || !Number.isSafeInteger(result)) throw new SourceImportError('INVALID_SUBTITLE');
  return result;
}

export function parseSource(bytes: Uint8Array, originalPath: string): SourceDocument {
  const format = extname(originalPath).slice(1).toLowerCase() as SourceFormat;
  if (!['srt', 'vtt', 'txt', 'md'].includes(format)) throw new SourceImportError('UNSUPPORTED_FORMAT');
  if (bytes.byteLength > MAX_FILE_BYTES) throw new SourceImportError('FILE_TOO_LARGE');
  const { rawText, encoding } = decodeSourceBytes(bytes);
  if (!rawText.trim()) throw new SourceImportError('EMPTY_FILE');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const sourceId = createHash('sha256').update(`${format}\0${checksum}`).digest('hex');
  const blocks = groups(sourceLines(rawText), format === 'srt' || format === 'vtt');
  if (format === 'vtt') {
    const header = blocks.next().value;
    if (!header || header.first.number !== 1 || !/^WEBVTT(?:[ \t].*)?$/.test(header.first.text) || header.timingCount || !header.headerMetadataValid) throw new SourceImportError('INVALID_SUBTITLE');
  }
  const segments: SourceSegment[] = [];
  for (const block of blocks) {
    let first = block.first;
    let startMs: number | undefined, endMs: number | undefined;
    if (format === 'srt' || format === 'vtt') {
      if (format === 'vtt' && /^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(block.first.text)) continue;
      const timingIndex = block.first.text.includes('-->') ? 0 : 1;
      if (format === 'srt' && timingIndex === 1 && !/^\d+$/.test(block.first.text.trim())) throw new SourceImportError('INVALID_SUBTITLE');
      const timingLine = timingIndex ? block.second : block.first;
      const textStart = timingIndex ? block.third : block.second;
      const timing = /^(\S+)\s+-->\s+(\S+)(?:[ \t]+.*)?$/.exec(timingLine?.text.trim() ?? '');
      if (!timing) throw new SourceImportError('INVALID_SUBTITLE');
      startMs = timestamp(timing[1], format);
      endMs = timestamp(timing[2], format);
      if (endMs <= startMs || !textStart || block.timingCount > 1) throw new SourceImportError('INVALID_SUBTITLE');
      first = textStart;
    }
    const last = block.last;
    const order = segments.length + 1;
    const segment: SourceSegment = {
      segmentId: `${sourceId}:${order}`, order,
      text: rawText.slice(first.start, last.end),
      range: { startLine: first.number, endLine: last.number, startOffset: first.start, endOffset: last.end },
    };
    if (startMs !== undefined) { segment.startMs = startMs; segment.endMs = endMs; }
    segments.push(segment);
    if (segments.length > MAX_SEGMENTS) throw new SourceImportError('TOO_MANY_SEGMENTS');
  }
  if (!segments.length) throw new SourceImportError('INVALID_SUBTITLE');
  return { sourceId, sourceType: 'file', originalPath, fileName: basename(originalPath), format, encoding, checksum, rawText, segments };
}
