import type { SourceDocument } from '../../contracts/source.ts';
import type { NoteOutline, NoteKind, SourceRef, NoteItem } from '../../contracts/analysis.ts';
import { validateOutline } from './validate.ts';
import { AnalysisError } from './errors.ts';
import { parseMarkdown } from '../reader/parse.ts';
import { ReaderError } from '../reader/errors.ts';
const labels: Record<NoteKind, string> = { summary: '摘要', point: '要点', support: '论据', example: '例子', limitation: '限制' };
function plain(text: string): string {
  return text.replace(/\s+/g, ' ').split(' ').map(word => {
    // GFM's text transform recognizes URLs after entity/backslash decoding.
    // Code spans keep URL-like source prose literal without granting a link.
    if (/(?:https?:|www\.|@)/i.test(word)) { const delimiter = '`'.repeat(Math.max(0, ...(word.match(/`+/g) ?? []).map(run => run.length)) + 1); return `${delimiter} ${word} ${delimiter}`; }
    return word.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|~=-]/g, '\\$&');
  }).join(' ');
}
function time(ms: number): string { const millis = ms % 1000, total = Math.floor(ms / 1000); return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60].map(n => String(n).padStart(2, '0')).join(':') + '.' + String(millis).padStart(3, '0'); }
export function renderMarkdown(outline: NoteOutline, source: SourceDocument): string {
  const valid = validateOutline(outline, source); const segments = new Map(source.segments.map(s => [s.segmentId, s]));
  const evidence = (refs: SourceRef[]) => refs.map(r => { const s = segments.get(r.segmentId)!; const label = s.startMs === undefined ? `段落${s.order}` : `${time(s.startMs)}–${time(s.endMs!)}`; return `[${label} · 字符${r.startOffset + 1}–${r.endOffset}](clipnote-source:${encodeURIComponent(r.segmentId)})`; }).join('；');
  const lines = [`# ${plain(valid.title)}`, ''];
  const item = (entry: NoteItem, depth: number) => { lines.push(`${'  '.repeat(depth)}- ${labels[entry.kind]}：${plain(entry.text)}（${evidence(entry.refs)}）`); entry.children.forEach(child => item(child, depth + 1)); };
  for (const section of valid.sections) { lines.push(`## ${plain(section.heading)}`, '', `依据：${evidence(section.refs)}`, ''); section.items.forEach(entry => item(entry, 0)); lines.push(''); }
  const markdown = lines.join('\n'); if (Buffer.byteLength(markdown, 'utf8') > 512 * 1024) throw new AnalysisError('TOO_LARGE');
  // Validate the real consumer's limits rather than estimating AST expansion.
  try { parseMarkdown(markdown); } catch (error) { if (error instanceof ReaderError) throw new AnalysisError('TOO_LARGE'); throw error; }
  return markdown;
}
