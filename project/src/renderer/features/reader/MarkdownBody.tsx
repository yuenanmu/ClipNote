import { createElement } from 'react';
import type { ReactNode } from 'react';
import type { Nodes, Definition } from 'mdast';
import type { ReaderDocument, ReaderLink } from '../../../contracts/reader.ts';
import { classifyLink } from '../../../modules/reader/links.ts';
export function MarkdownBody({ document, start, end, activeId, onLink }: { document: ReaderDocument; start: number; end: number; activeId?: string; onLink(link: ReaderLink): void }) {
  const definitions = new Map<string, Definition>();
  const pending: Nodes[] = [document.content.root];
  while (pending.length) { const node = pending.pop()!; if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node); if ('children' in node) pending.push(...node.children); }
  const link = (url: string, children: ReactNode, key: string): ReactNode => {
    const action = classifyLink(url, document.content, document.archive);
    return <button className="reader-link" key={key} disabled={action.kind === 'blocked'} title={action.kind === 'blocked' ? '此链接未开放，未访问文件或网络' : url} onClick={() => onLink(action)}>{children}</button>;
  };
  const render = (node: Nodes, key: string): ReactNode => {
    const id = (node.data as { readerId?: string })?.readerId;
    const anchor = { id: `reader-${id}`, 'data-reader-anchor': id, 'data-reader-active': id === activeId ? 'true' : undefined, tabIndex: -1 };
    const children = 'children' in node ? node.children.map((child, index) => render(child as Nodes, `${key}-${index}`)) : undefined;
    switch (node.type) {
      case 'text': return node.value;
      case 'paragraph': return <p key={key} {...anchor}>{children}</p>;
      case 'heading': {
        const id = (node.data as { id?: string })?.id;
        return createElement(`h${node.depth}`, { key, id: `reader-${id}`, 'data-reader-anchor': id, 'data-reader-active': id === activeId ? 'true' : undefined, tabIndex: -1 }, children);
      }
      case 'strong': return <strong key={key}>{children}</strong>;
      case 'emphasis': return <em key={key}>{children}</em>;
      case 'delete': return <del key={key}>{children}</del>;
      case 'inlineCode': return <code key={key}>{node.value}</code>;
      case 'code': return <pre key={key} {...anchor}><code>{node.value}</code></pre>;
      case 'html': return <pre className="reader-literal" key={key} {...anchor}>{node.value}</pre>;
      case 'blockquote': return <blockquote key={key}>{children}</blockquote>;
      case 'list': return node.ordered ? <ol key={key} start={node.start ?? 1}>{children}</ol> : <ul key={key}>{children}</ul>;
      case 'listItem': return <li key={key} {...anchor}>{typeof node.checked === 'boolean' && <input type="checkbox" checked={node.checked} disabled aria-label={node.checked ? '已完成' : '未完成'} />}{children}</li>;
      case 'thematicBreak': return <hr key={key} />;
      case 'break': return <br key={key} />;
      case 'link': return link(node.url, children, key);
      case 'linkReference': return link(definitions.get(node.identifier.toLowerCase())?.url ?? '', children, key);
      case 'image': case 'imageReference': return <span className="reader-image-placeholder" key={key}>[图片：{node.alt || '未命名'}，未自动加载]</span>;
      case 'table': return <div className="reader-table" key={key} {...anchor}><table><tbody>{children}</tbody></table></div>;
      case 'tableRow': return <tr key={key}>{children}</tr>;
      case 'tableCell': return <td key={key}>{children}</td>;
      case 'footnoteReference': return <sup key={key}>[{node.label ?? node.identifier}]</sup>;
      case 'footnoteDefinition': return <aside className="reader-footnote" key={key} {...anchor}><span>[{node.label ?? node.identifier}]</span>{children}</aside>;
      case 'definition': case 'yaml': case 'toml': return null;
      default: return children ?? ('value' in node ? <pre key={key}>{String(node.value)}</pre> : null);
    }
  };
  return <article className="markdown-body" data-testid="reader-body">{document.content.root.children.slice(start, end).map((node, index) => render(node, String(start + index)))}</article>;
}
