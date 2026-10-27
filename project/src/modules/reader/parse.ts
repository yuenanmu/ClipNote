import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import type { Nodes, Root } from 'mdast';
import type { ReaderContent, ReaderHeading } from '../../contracts/reader.ts';
import { ReaderError } from './errors.ts';
import { externalUrl } from './links.ts';
import { buildMindmap } from './mindmap.ts';
export { classifyLink, externalUrl } from './links.ts';
export const MAX_READER_BYTES = 2 * 1024 * 1024;
const processor = unified().use(remarkParse).use(remarkFrontmatter, ['yaml', 'toml']).use(remarkGfm);
function title(node: Nodes): string {
  if ('children' in node) return node.children.map(child => title(child)).join('');
  return 'value' in node ? node.value : node.type === 'image' || node.type === 'imageReference' ? node.alt ?? '' : '';
}
export function parseMarkdown(text: string): ReaderContent {
  if (new TextEncoder().encode(text).byteLength > MAX_READER_BYTES) throw new ReaderError('READER_TOO_LARGE');
  const root = processor.parse(text) as Root;
  const headings: ReaderHeading[] = [], parents: ReaderHeading[] = [], used = new Set<string>(), links = new Set<string>();
  const pending = root.children.map((node, blockIndex) => ({ node: node as Nodes, blockIndex, level: 1 })).reverse();
  let count = 0;
  while (pending.length) {
    const { node, blockIndex, level } = pending.pop()!;
    if (++count > 20_000 || level > 64) throw new ReaderError('READER_TOO_COMPLEX');
    if (node.type === 'heading') {
      const label = title(node), base = label.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
      let id = base, suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
      used.add(id); node.data = { ...node.data, id };
      const heading: ReaderHeading = { id, title: label || '无标题', depth: node.depth, blockIndex, children: [] };
      while (parents.length && parents.at(-1)!.depth >= heading.depth) parents.pop();
      (parents.at(-1)?.children ?? headings).push(heading); parents.push(heading);
    }
    node.data = { ...node.data, readerId: node.type === 'heading' ? (node.data as { id?: string })?.id : `@md-${count}` };
    if ((node.type === 'link' || node.type === 'definition') && externalUrl(node.url)) links.add(externalUrl(node.url)!);
    if ('children' in node) for (let index = node.children.length - 1; index >= 0; index--) pending.push({ node: node.children[index] as Nodes, blockIndex, level: level + 1 });
  }
  return { root, headings, links: [...links], mindmap: buildMindmap(root) };
}
