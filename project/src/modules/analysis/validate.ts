import type { AnalysisChunk, NoteOutline, NoteItem, SourceRef, NoteKind } from '../../contracts/analysis.ts';
import type { SourceDocument } from '../../contracts/source.ts';
import { AnalysisError } from './errors.ts';
import { checkSource } from './plan.ts';
export function validateOutline(value: unknown, source: SourceDocument, chunk?: AnalysisChunk): NoteOutline {
  checkSource(source);
  const segments = new Map(source.segments.map(s => [s.segmentId, s])); let nodes = 0, characters = 0, references = 0;
  const invalid = () => { throw new AnalysisError('INVALID_STRUCTURE'); };
  const record = (v: unknown, keys: string[]): Record<string, any> => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Object.keys(v).length !== keys.length || !keys.every(k => Object.hasOwn(v, k))) return invalid();
    return v as Record<string, any>;
  };
  const text = (v: unknown, max: number): string => { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)) return invalid(); characters += v.length; if (characters > 512000) return invalid(); return v.trim(); };
  const refs = (v: unknown): SourceRef[] => {
    if (!Array.isArray(v) || !v.length || v.length > 64 || (references += v.length) > 20000) throw new AnalysisError('INVALID_REFERENCE');
    const result = v.map(r => {
      if (!r || typeof r !== 'object' || Object.keys(r).length !== 3 || !['segmentId', 'startOffset', 'endOffset'].every(k => Object.hasOwn(r, k))) throw new AnalysisError('INVALID_REFERENCE');
      const s = segments.get(r.segmentId);
      if (!s || !Number.isSafeInteger(r.startOffset) || !Number.isSafeInteger(r.endOffset) || r.startOffset < 0 || r.endOffset <= r.startOffset || r.endOffset > s.text.length || (r.startOffset > 0 && /[\uDC00-\uDFFF]/.test(s.text[r.startOffset])) || (r.endOffset < s.text.length && /[\uDC00-\uDFFF]/.test(s.text[r.endOffset]))) throw new AnalysisError('INVALID_REFERENCE');
      if (chunk && ![...chunk.core, ...chunk.context].some(allowed => allowed.segmentId === r.segmentId && allowed.startOffset <= r.startOffset && allowed.endOffset >= r.endOffset)) throw new AnalysisError('INVALID_REFERENCE');
      return { segmentId: r.segmentId as string, startOffset: r.startOffset as number, endOffset: r.endOffset as number };
    });
    return [...new Map(result.map(r => [JSON.stringify(r), r])).values()];
  };
  const items = (v: unknown, depth: number): NoteItem[] => {
    if (!Array.isArray(v) || depth > 8 || v.length > 2000) return invalid();
    return v.map(raw => { if (++nodes > 2000) return invalid(); const item = record(raw, ['kind', 'text', 'refs', 'children']);
      if (!['summary', 'point', 'support', 'example', 'limitation'].includes(item.kind)) return invalid();
      return { kind: item.kind as NoteKind, text: text(item.text, 16000), refs: refs(item.refs), children: item.children?.length ? items(item.children, depth + 1) : items(item.children, depth) };
    });
  };
  const root = record(value, ['title', 'sections']); const title = text(root.title, 256);
  if (!Array.isArray(root.sections) || !root.sections.length || root.sections.length > 1000) return invalid();
  return { title, sections: root.sections.map((raw: unknown) => { if (++nodes > 2000) return invalid(); const section = record(raw, ['heading', 'refs', 'items']); const children = items(section.items, 1); if (!children.length) return invalid(); return { heading: text(section.heading, 256), refs: refs(section.refs), items: children }; }) };
}
