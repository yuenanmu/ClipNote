import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MindmapNode, ReaderDocument, ReaderHeading, ReaderLink, ReaderPosition } from '../../../contracts/reader.ts';
import { MarkdownBody } from './MarkdownBody.tsx';
import { MindmapView } from './MindmapView.tsx';
import { boundSplitRatio, readSplitRatio, SPLIT_PREFERENCE } from './split-preference.ts';
import './reader.css';
const PAGE_SIZE = 100;
type ReadingMode = 'markdown' | 'mindmap' | 'split';
export function ReaderView({ document: note, navigation, busy, notice, onOpen, onBack, onRefresh, onExternal, onExternalLink, onSource }: {
  navigation?: ReactNode;
  document: ReaderDocument; busy: boolean; notice?: { text: string; error?: boolean };
  onOpen(): void; onBack(): void; onRefresh(): void; onExternal(): void; onExternalLink(url: string): void; onSource(segmentId?: string): void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()), [page, setPage] = useState(0), [active, setActive] = useState<string>();
  const [target, setTarget] = useState<ReaderPosition>(), [mapFocus, setMapFocus] = useState<ReaderPosition>();
  const [mode, setMode] = useState<ReadingMode>('mindmap'), [sidebar, setSidebar] = useState<'notes' | 'outline'>('notes');
  const [navHidden, setNavHidden] = useState(false), [paneWidth, setPaneWidth] = useState(1000);
  const [ratio, setRatio] = useState(() => { try { return readSplitRatio(window.localStorage); } catch { return .4; } });
  const scroll = useRef<HTMLDivElement>(null), panes = useRef<HTMLDivElement>(null), dragging = useRef(false);
  useEffect(() => { setMode('mindmap'); setSidebar('notes'); }, [note.readerId]);
  useEffect(() => { setPage(0); setActive(undefined); setCollapsed(new Set()); setTarget(undefined); setMapFocus(undefined); if (scroll.current) scroll.current.scrollTop = 0; }, [note.readerId, note.checksum]);
  useEffect(() => {
    if (!target) return;
    const element = window.document.getElementById(`reader-${target.id}`);
    if (element) { element.scrollIntoView({ block: 'start', inline: 'nearest' }); element.focus({ preventScroll: true }); }
  }, [target, page]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => { if (entries[0].contentRect.width) setPaneWidth(entries[0].contentRect.width); });
    observer.observe(panes.current!); return () => observer.disconnect();
  }, []);
  useEffect(() => { try { window.localStorage.setItem(SPLIT_PREFERENCE, String(ratio)); } catch { /* Reading works when preference storage is unavailable. */ } }, [ratio]);
  const split = boundSplitRatio(ratio, paneWidth);
  const chooseMode = (next: ReadingMode) => { setMode(next); if (next === 'markdown') setSidebar('outline'); };
  const locate = (position: ReaderPosition) => { setPage(Math.floor(position.blockIndex / PAGE_SIZE)); setActive(position.id); setTarget({ ...position }); };
  const viewOriginal = (position: ReaderPosition) => { if (mode !== 'split') { setMode('markdown'); setSidebar('outline'); } locate(position); };
  const selectNode = (node: MindmapNode) => { setActive(node.id); if (mode === 'split' && node.target) locate(node.target); };
  const jump = (heading: ReaderHeading) => {
    const position = { id: heading.id, blockIndex: heading.blockIndex }; setActive(heading.id);
    if (mode !== 'mindmap') locate(position);
    if (mode !== 'markdown') setMapFocus({ ...position });
  };
  const find = (id: string) => { const pending = [...note.content.headings]; while (pending.length) { const heading = pending.pop()!; if (heading.id === id) { jump(heading); return; } pending.push(...heading.children); } };
  const onLink = (link: ReaderLink) => { if (link.kind === 'anchor') find(link.id); else if (link.kind === 'source') onSource(link.segmentId); else if (link.kind === 'external') onExternalLink(link.url); };
  const tree = (headings: ReaderHeading[]) => <ul>{headings.map(heading => <li key={heading.id}>
    <div className={`outline-row ${active === heading.id ? 'active' : ''}`}>
      {heading.children.length ? <button className="outline-toggle" aria-expanded={!collapsed.has(heading.id)} aria-label={`${collapsed.has(heading.id) ? '展开' : '收起'} ${heading.title}`} onClick={() => setCollapsed(previous => { const next = new Set(previous); next.has(heading.id) ? next.delete(heading.id) : next.add(heading.id); return next; })}>{collapsed.has(heading.id) ? '›' : '⌄'}</button> : <span className="outline-spacer" />}
      <button className="outline-label" aria-label={`定位标题 ${heading.title}`} aria-current={active === heading.id ? 'location' : undefined} onClick={() => jump(heading)} title={heading.title}>{heading.title}</button>
    </div>{!collapsed.has(heading.id) && !!heading.children.length && tree(heading.children)}
  </li>)}</ul>;
  const pages = Math.max(1, Math.ceil(note.content.root.children.length / PAGE_SIZE));
  const changePage = (next: number) => { setPage(next); setTarget(undefined); if (scroll.current) scroll.current.scrollTop = 0; };
  const moveDivider = (clientX: number) => { const rect = panes.current!.getBoundingClientRect(); setRatio(boundSplitRatio((clientX - rect.left - 4) / (rect.width - 8), rect.width)); };
  return <div className={`reader-shell ${navHidden ? 'nav-collapsed' : ''}`}>
    <aside className="reader-outline" id="reader-navigation" hidden={navHidden}>
      <div className="reader-brand">ClipNote<span>笔记与思路</span></div><button className="reader-back" aria-label="返回文件工作台" disabled={busy} onClick={onBack}>← 返回文件工作台</button>
      <div className="reader-nav-tabs"><button aria-pressed={sidebar === 'notes'} onClick={() => setSidebar('notes')}>笔记</button><button aria-pressed={sidebar === 'outline'} onClick={() => setSidebar('outline')}>大纲</button></div>
      <div className="reader-note-list" hidden={sidebar !== 'notes'}>{navigation}</div>
      <div className="outline-heading" hidden={sidebar !== 'outline'}>文档目录 <span>只读</span></div>
      <nav aria-label="Markdown 标题目录" hidden={sidebar !== 'outline'}>{note.content.headings.length ? tree(note.content.headings) : <p className="outline-empty">本文没有标题，可直接阅读正文与脑图。</p>}</nav>
      <p className="reader-offline"><i />本地阅读 · 无需登录</p>
    </aside>
    <main className="reader-main" aria-busy={busy}>
      <header className="reader-toolbar"><div><p className="eyebrow">{note.archive ? '笔记 / 归档版本' : '笔记 / 本地文件'}</p><h1 title={note.fileName}>{note.fileName}</h1><p className="reader-file-path" title={note.filePath}>{note.filePath}</p></div><div className="reader-actions"><button className="secondary" disabled={busy} onClick={onOpen}>添加 Markdown</button><button className="secondary" disabled={busy} onClick={onRefresh}>刷新文件</button><button className="secondary" disabled={busy} onClick={onExternal}>外部打开</button>{note.archive && <button className="primary" disabled={busy} onClick={() => onSource()}>查看来源</button>}</div></header>
      <div className="reader-view-switch" aria-label="笔记观看模式"><button aria-label={navHidden ? '展开导航' : '收起导航'} aria-expanded={!navHidden} aria-controls="reader-navigation" onClick={() => setNavHidden(old => !old)}>{navHidden ? '☷' : '⇤'}</button><button aria-pressed={mode === 'markdown'} onClick={() => chooseMode('markdown')}>Markdown</button><button aria-pressed={mode === 'mindmap'} onClick={() => chooseMode('mindmap')}>Mindmap</button><button aria-pressed={mode === 'split'} onClick={() => chooseMode('split')}>对照</button><span>{mode === 'split' ? '拖动中线调整比例 · 点击节点定位原文' : mode === 'mindmap' ? '按章节展开 · 文字直接阅读' : '阅读原文 · 大纲可折叠定位'}</span></div>
      {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
      {note.noteModified && <div className="reader-modified">此笔记已被外部修改，当前显示磁盘内容。</div>}
      <div className={`reader-panes mode-${mode}`} ref={panes} style={mode === 'split' ? { gridTemplateColumns: `${split}fr 8px ${1 - split}fr` } : undefined}>
        <div ref={scroll} className="reader-scroll" hidden={mode === 'mindmap'}>
          {!note.content.root.children.length && <p className="reader-empty">这是一份空 Markdown。</p>}
          <MarkdownBody document={note} start={page * PAGE_SIZE} end={(page + 1) * PAGE_SIZE} activeId={active} onLink={onLink} />
          {pages > 1 && <div className="pagination reader-pagination"><button disabled={page === 0} onClick={() => changePage(page - 1)}>上一页正文</button><span>正文第 {page + 1} / {pages} 页 · 目录可直接定位</span><button disabled={page + 1 >= pages} onClick={() => changePage(page + 1)}>下一页正文</button></div>}
        </div>
        <div className="reader-divider" hidden={mode !== 'split'} role="separator" aria-label="调整 Markdown 与脑图比例" aria-orientation="vertical" aria-valuemin={Math.round(boundSplitRatio(0, paneWidth) * 100)} aria-valuemax={Math.round(boundSplitRatio(1, paneWidth) * 100)} aria-valuenow={Math.round(split * 100)} aria-valuetext={`Markdown ${Math.round(split * 100)}%，Mindmap ${Math.round((1 - split) * 100)}%`} tabIndex={0}
          onPointerDown={event => { event.preventDefault(); dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { if (dragging.current) moveDivider(event.clientX); }}
          onPointerUp={event => { dragging.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={() => { dragging.current = false; }} onDoubleClick={() => setRatio(.4)}
          onKeyDown={event => { const step = event.shiftKey ? .1 : .02; if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setRatio(boundSplitRatio(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : split + (event.key === 'ArrowLeft' ? -step : step), paneWidth)); } }}><span /></div>
        <div className="mindmap-holder" hidden={mode === 'markdown'}><MindmapView key={`${note.readerId}:${note.checksum}`} document={note} visible={mode !== 'markdown'} selectedId={active} focus={mapFocus} onSelect={selectNode} onJump={viewOriginal} /></div>
      </div>
      <footer className="reader-footer"><span>{note.encoding.toUpperCase()} · {note.archive ? '保留来源追溯' : '直接阅读，不执行分析'}</span><span>外部修改后点击刷新 · 图片不自动加载</span></footer>
    </main>
  </div>;
}
