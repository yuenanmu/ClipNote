import type { Nodes, Root } from 'mdast';
import type { MindmapNode, ReaderPosition } from '../../contracts/reader.ts';
function plain(node: Nodes): string {
  if (node.type === 'html') return '';
  if ('children' in node) return node.children.map(child => plain(child as Nodes)).join(node.type === 'table' || node.type === 'tableRow' ? ' · ' : '');
  return 'value' in node ? node.value : node.type === 'image' || node.type === 'imageReference' ? node.alt ?? '' : '';
}
export function buildMindmap(root: Root): MindmapNode {
  const result: MindmapNode = { id: '@map-root', label: '文档', details: [], children: [] };
  const headings: { depth: number; map: MindmapNode }[] = [];
  const position = (node: Nodes, blockIndex: number): ReaderPosition => ({ id: String((node.data as { readerId?: string })?.readerId), blockIndex });
  const make = (node: Nodes, blockIndex: number, label: string): MindmapNode => ({ id: position(node, blockIndex).id, label, target: position(node, blockIndex), details: [], children: [] });
  function walk(nodes: Nodes[], parent: MindmapNode, blockIndex: number, inList = false) {
    let current = parent;
    for (const node of nodes) {
      if (node.type === 'heading' && !inList) {
        while (headings.length && headings.at(-1)!.depth >= node.depth) headings.pop();
        const entry = make(node, blockIndex, plain(node) || '无标题');
        (headings.at(-1)?.map ?? result).children.push(entry); headings.push({ depth: node.depth, map: entry }); current = entry;
      } else if (node.type === 'list') {
        for (const item of node.children) {
          const first = item.children.find(child => child.type === 'paragraph' || child.type === 'heading');
          const entry = make(item, blockIndex, first ? plain(first) || '列表项' : '列表项'); current.children.push(entry);
          walk(item.children.filter(child => child !== first) as Nodes[], entry, blockIndex, true);
        }
      } else if (node.type === 'blockquote') walk(node.children as Nodes[], current, blockIndex, inList);
      else if (!['yaml', 'toml', 'definition', 'html', 'thematicBreak'].includes(node.type)) {
        const text = plain(node).trim(); if (text) current.details.push({ text, target: position(node, blockIndex) });
      }
    }
  }
  for (let index = 0; index < root.children.length; index++) walk([root.children[index] as Nodes], headings.at(-1)?.map ?? result, index);
  return result;
}
