import type { IPureNode } from 'markmap-common';
import type { MindmapNode } from '../../../contracts/reader.ts';
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export function markmapData(source: MindmapNode, fileName: string): { root: IPureNode; nodes: Map<string, MindmapNode>; parents: Map<string, string> } {
  const top = source.children.length === 1 && source.children[0].kind === 'heading' ? source.children[0] : { ...source, label: fileName.replace(/\.md$/i, '') };
  const nodes = new Map<string, MindmapNode>(), parents = new Map<string, string>();
  function convert(node: MindmapNode, parent?: string): IPureNode {
    nodes.set(node.id, node); if (parent) parents.set(node.id, parent);
    const text = escape(node.label);
    return { content: `<button type="button" class="markmap-label" data-reader-node="${encodeURIComponent(node.id)}" aria-label="选择节点 ${text}">${text}</button>`, payload: { nodeId: node.id, blockIndex: node.target?.blockIndex, kind: node.kind }, children: node.children.map(child => convert(child, node.id)) };
  }
  return { root: convert(top), nodes, parents };
}
