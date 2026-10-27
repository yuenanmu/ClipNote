import { useEffect, useRef, useState } from 'react';
import type { ReaderDocument, ReaderHeading, ReaderLink } from '../../../contracts/reader.ts';
import { MarkdownBody } from './MarkdownBody.tsx';
import './reader.css';
const PAGE_SIZE = 100;
export function ReaderView({ document: note, busy, notice, onOpen, onBack, onRefresh, onExternal, onExternalLink, onSource }: {
  document: ReaderDocument; busy: boolean; notice?: { text: string; error?: boolean };
  onOpen(): void; onBack(): void; onRefresh(): void; onExternal(): void; onExternalLink(url: string): void; onSource(segmentId?: string): void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()), [page, setPage] = useState(0), [active, setActive] = useState<string>();
  const [target, setTarget] = useState<{ id: string }>();
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { setPage(0); setActive(undefined); setCollapsed(new Set()); setTarget(undefined); if (scroll.current) scroll.current.scrollTop = 0; }, [note.readerId, note.checksum]);
  useEffect(() => {
    if (!target) return;
    const element = window.document.getElementById(`reader-${target.id}`);
    if (element) { element.scrollIntoView({ block: 'start' }); element.focus({ preventScroll: true }); }
  }, [target, page]);
  const jump = (heading: ReaderHeading) => { setPage(Math.floor(heading.blockIndex / PAGE_SIZE)); setActive(heading.id); setTarget({ id: heading.id }); };
  const find = (id: string) => { const pending = [...note.content.headings]; while (pending.length) { const heading = pending.pop()!; if (heading.id === id) { jump(heading); return; } pending.push(...heading.children); } };
  const onLink = (link: ReaderLink) => { if (link.kind === 'anchor') find(link.id); else if (link.kind === 'source') onSource(link.segmentId); else if (link.kind === 'external') onExternalLink(link.url); };
  const tree = (headings: ReaderHeading[]) => <ul>{headings.map(heading => <li key={heading.id}>
    <div className={`outline-row ${active === heading.id ? 'active' : ''}`}>
      {heading.children.length ? <button className="outline-toggle" aria-expanded={!collapsed.has(heading.id)} aria-label={`${collapsed.has(heading.id) ? '展开' : '收起'} ${heading.title}`} onClick={() => setCollapsed(previous => { const next = new Set(previous); next.has(heading.id) ? next.delete(heading.id) : next.add(heading.id); return next; })}>{collapsed.has(heading.id) ? '›' : '⌄'}</button> : <span className="outline-spacer" />}
      <button className="outline-label" aria-label={`定位标题 ${heading.title}`} aria-current={active === heading.id ? 'location' : undefined} onClick={() => jump(heading)} title={heading.title}>{heading.title}</button>
    </div>{!collapsed.has(heading.id) && !!heading.children.length && tree(heading.children)}
  </li>)}</ul>;
  const pages = Math.max(1, Math.ceil(note.content.root.children.length / PAGE_SIZE));
  const changePage = (next: number) => { setPage(next); setActive(undefined); setTarget(undefined); if (scroll.current) scroll.current.scrollTop = 0; };
  return <div className="reader-shell">
    <aside className="reader-outline"><div className="reader-brand">ClipNote<span>本地阅读</span></div><button className="reader-back" aria-label="返回文件工作台" disabled={busy} onClick={onBack}>← 返回文件工作台</button><div className="outline-heading">文档目录 <span>只读</span></div>
      <nav aria-label="Markdown 标题目录">{note.content.headings.length ? tree(note.content.headings) : <p className="outline-empty">本文没有标题，可直接阅读正文。</p>}</nav><p className="reader-offline"><i />本地阅读 · 无需登录</p>
    </aside>
    <main className="reader-main" aria-busy={busy}>
      <header className="reader-toolbar"><div><p className="eyebrow">{note.archive ? '归档版本 / Markdown 阅读' : '本地文件 / Markdown 阅读'}</p><h1 title={note.fileName}>{note.fileName}</h1><p className="reader-file-path" title={note.filePath}>{note.filePath}</p></div><div className="reader-actions"><button className="secondary" disabled={busy} onClick={onOpen}>打开 Markdown</button><button className="secondary" disabled={busy} onClick={onRefresh}>刷新文件</button><button className="secondary" disabled={busy} onClick={onExternal}>外部打开</button>{note.archive && <button className="primary" disabled={busy} onClick={() => onSource()}>查看来源</button>}</div></header>
      {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
      {note.noteModified && <div className="reader-modified">此笔记已被外部修改，当前显示磁盘内容。</div>}
      <div ref={scroll} className="reader-scroll">
        {!note.content.root.children.length && <p className="reader-empty">这是一份空 Markdown。</p>}
        <MarkdownBody document={note} start={page * PAGE_SIZE} end={(page + 1) * PAGE_SIZE} onLink={onLink} />
        {pages > 1 && <div className="pagination reader-pagination"><button disabled={page === 0} onClick={() => changePage(page - 1)}>上一页正文</button><span>正文第 {page + 1} / {pages} 页 · 目录可直接定位</span><button disabled={page + 1 >= pages} onClick={() => changePage(page + 1)}>下一页正文</button></div>}
      </div>
      <footer className="reader-footer"><span>{note.encoding.toUpperCase()} · {note.archive ? '保留来源追溯' : '直接阅读，不执行分析'}</span><span>外部修改后点击刷新 · 图片不自动加载</span></footer>
    </main>
  </div>;
}
