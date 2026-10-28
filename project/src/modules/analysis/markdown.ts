import type { SourceDocument } from '../../contracts/source.ts';
import type { NoteOutline, NoteItem } from '../../contracts/analysis.ts';
import { validateOutline } from './validate.ts';
import { AnalysisError } from './errors.ts';
import { parseMarkdown } from '../reader/parse.ts';
import { ReaderError } from '../reader/errors.ts';
function plain(text: string): string {
  return text.replace(/\s+/g, ' ').split(' ').map(word => {
    // GFM's text transform recognizes URLs after entity/backslash decoding.
    // Code spans keep URL-like source prose literal without granting a link.
    if (/(?:https?:|www\.|@)/i.test(word)) { const delimiter = '`'.repeat(Math.max(0, ...(word.match(/`+/g) ?? []).map(run => run.length)) + 1); return `${delimiter} ${word} ${delimiter}`; }
    return word.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()#+.!|~=-]/g, '\\$&');
  }).join(' ');
}
export function renderMarkdown(outline: NoteOutline, source: SourceDocument): string {
  const valid = validateOutline(outline, source);
  const lines = [`# ${plain(valid.title)}`, ''];
  const item = (entry: NoteItem, depth: number) => { lines.push(`${'  '.repeat(depth)}- ${plain(entry.text)}`); entry.children.forEach(child => item(child, depth + 1)); };
  for (const section of valid.sections) { lines.push(`## ${plain(section.heading)}`, ''); section.items.forEach(entry => item(entry, 0)); lines.push(''); }
  const markdown = lines.join('\n'); if (Buffer.byteLength(markdown, 'utf8') > 512 * 1024) throw new AnalysisError('TOO_LARGE');
  // Validate the real consumer's limits rather than estimating AST expansion.
  try { parseMarkdown(markdown); } catch (error) { if (error instanceof ReaderError) throw new AnalysisError('TOO_LARGE'); throw error; }
  return markdown;
}
