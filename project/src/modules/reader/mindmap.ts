import type { Nodes, Root } from 'mdast';
import type { MindmapNode, ReaderPosition } from '../../contracts/reader.ts';
function plain(node: Nodes): string {
  if (node.type === 'break') return '\n';
  if (node.type === 'html') return '';
  if ('children' in node) return node.children.map(child => plain(child as Nodes)).join(node.type === 'table' || node.type === 'tableRow' ? ' · ' : '');
  return 'value' in node ? node.value : node.type === 'image' || node.type === 'imageReference' ? node.alt ?? '' : '';
}
export function buildMindmap(root: Root): MindmapNode {
  const result: MindmapNode = { id: '@map-root', kind: 'root', label: '文档', children: [] };
  const headings: { depth: number; map: MindmapNode }[] = [];
  const position = (node: Nodes, blockIndex: number): ReaderPosition => ({ id: String((node.data as { readerId?: string })?.readerId), blockIndex });
  const make = (node: Nodes, blockIndex: number, label: string, kind: MindmapNode['kind']): MindmapNode => ({ id: position(node, blockIndex).id, kind, label, target: position(node, blockIndex), children: [] });
  function walk(nodes: Nodes[], parent: MindmapNode, blockIndex: number, inList = false) {
    let current = parent;
    const localHeadings: { depth: number; map: MindmapNode }[] = [];
    for (const node of nodes) {
      if (node.type === 'heading') {
        const stack = inList ? localHeadings : headings;
        while (stack.length && stack.at(-1)!.depth >= node.depth) stack.pop();
        const entry = make(node, blockIndex, plain(node) || '无标题', 'heading');
        (stack.at(-1)?.map ?? (inList ? parent : result)).children.push(entry); stack.push({ depth: node.depth, map: entry }); current = entry;
      } else if (node.type === 'list') {
        for (const item of node.children) {
          const first = item.children[0]?.type === 'paragraph' ? item.children[0] : undefined;
          const entry = make(item, blockIndex, first ? plain(first) || '列表项' : '列表项', 'listItem'); current.children.push(entry);
          walk(item.children.filter(child => child !== first) as Nodes[], entry, blockIndex, true);
        }
      } else if (node.type === 'blockquote') walk(node.children as Nodes[], current, blockIndex, inList);
      else if (node.type === 'code') current.children.push(make(node, blockIndex, `代码${node.lang ? ` · ${node.lang}` : ''} · ${node.value.split('\n').length}行`, 'code'));
      else if (node.type === 'table') current.children.push(make(node, blockIndex, `表格 · ${node.children.length}行`, 'table'));
      else if (!['yaml', 'toml', 'definition', 'thematicBreak'].includes(node.type)) {
        const text = node.type === 'html' ? node.value : plain(node).trim();
        if (text) current.children.push(make(node, blockIndex, text, 'paragraph'));
      }
    }
  }
  for (let index = 0; index < root.children.length; index++) walk([root.children[index] as Nodes], headings.at(-1)?.map ?? result, index);
  return result;
}
