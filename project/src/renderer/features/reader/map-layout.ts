import type { MindmapNode } from '../../../contracts/reader.ts';
export interface MapBox { node: MindmapNode; x: number; y: number; width: number; height: number; lines: string[]; parent?: string; color: number }
function lines(text: string): string[] {
  const result: string[] = []; let line = '', length = 0;
  for (const char of text.replace(/\s+/g, ' ')) {
    const size = /[^\u0000-\u00ff]/u.test(char) ? 2 : 1;
    if (length + size > 28) { result.push(line); line = ''; length = 0; if (result.length === 4) break; }
    line += char; length += size;
  }
  if (result.length < 4 && line) result.push(line);
  if (result.join('').length < text.replace(/\s+/g, ' ').length && result.length) result[result.length - 1] += '…';
  return result.length ? result : ['未命名'];
}
export function layoutMindmap(root: MindmapNode, collapsed: Set<string>) {
  const nodes: MapBox[] = [], sizes = new Map<string, number>(), labels = new Map<string, string[]>();
  function measure(node: MindmapNode): number {
    const label = lines(node.label); labels.set(node.id, label);
    const own = 28 + label.length * 20 + (node.details.length ? 24 : 0);
    const height = Math.max(own, collapsed.has(node.id) ? 0 : node.children.reduce((sum, child) => sum + measure(child) + 20, -20));
    sizes.set(node.id, height); return height;
  }
  const height = measure(root) + 80;
  function place(node: MindmapNode, depth: number, top: number, color: number, parent?: string) {
    const label = labels.get(node.id)!, own = 28 + label.length * 20 + (node.details.length ? 24 : 0);
    nodes.push({ node, parent, color, x: 40 + depth * 320, y: top + (sizes.get(node.id)! - own) / 2, width: 240, height: own, lines: label });
    if (collapsed.has(node.id)) return;
    let next = top;
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index]; place(child, depth + 1, next, depth === 0 ? index : color, node.id); next += sizes.get(child.id)! + 20;
    }
  }
  place(root, 0, 40, 0);
  return { nodes, width: Math.max(...nodes.map(node => node.x + node.width)) + 60, height };
}
