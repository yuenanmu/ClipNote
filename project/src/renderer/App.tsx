import { useEffect, useRef, useState } from 'react';
import type { DesktopApi } from '../contracts/desktop.ts';
import type { SourceDocument } from '../contracts/source.ts';
import type { LibraryState, SavedRevision } from '../contracts/storage.ts';
import { LibrarySidebar } from './LibrarySidebar.tsx';

declare global { interface Window { clipnote: DesktopApi } }
const PAGE_SIZE = 100;
const RAW_PREVIEW_LIMIT = 200_000;
const paths = {
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  plus: 'M12 5v14 M5 12h14',
  layers: 'M12 3 2 8l10 5 10-5-10-5z M2 12l10 5 10-5 M2 16l10 5 10-5',
  shield: 'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
};
function Icon({ name = 'file', size = 20 }: { name?: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function time(milliseconds: number): string {
  const total = Math.floor(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;
}

export function App() {
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<'segments' | 'raw'>('segments');
  const [page, setPage] = useState(0);
  const [rawPage, setRawPage] = useState(0);
  const rawMark = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(true);
  const [library, setLibrary] = useState<LibraryState>({ directory: null, revisions: [], drafts: [], warnings: [] });
  const [savedVersion, setSavedVersion] = useState<SavedRevision>();
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const document = documents.find(item => item.sourceId === activeId);
  const segment = document?.segments[selected];
  const rawStart = rawPage * RAW_PREVIEW_LIMIT;
  const rawEnd = Math.min(rawStart + RAW_PREVIEW_LIMIT, document?.rawText.length ?? 0);
  const highlightStart = Math.max(rawStart, segment?.range.startOffset ?? rawStart);
  const highlightEnd = Math.min(rawEnd, segment?.range.endOffset ?? rawStart);
  useEffect(() => { if (view === 'raw') rawMark.current?.scrollIntoView({ block: 'center' }); }, [view, selected, rawPage, activeId]);
  const openOriginal = () => { setRawPage(Math.floor((segment?.range.startOffset ?? 0) / RAW_PREVIEW_LIMIT)); setView('raw'); };

  const selectDocument = (source: SourceDocument) => { setActiveId(source.sourceId); setSelected(0); setPage(0); setRawPage(0); setView('segments'); setNotice(undefined); setSavedVersion(undefined); };
  const addDocument = (source: SourceDocument) => { setDocuments(previous => [source, ...previous.filter(item => item.sourceId !== source.sourceId)].slice(0, 5)); selectDocument(source); };
  const refreshLibrary = async () => {
    const result = await window.clipnote.libraryState();
    if (result.status !== 'ok') throw new Error('Library unavailable');
    setLibrary(result.value);
  };
  useEffect(() => {
    let active = true;
    window.clipnote.libraryState().then(result => {
      if (result.status !== 'ok') throw new Error('Library unavailable');
      if (active) setLibrary(result.value);
    }).catch(() => { if (active) setNotice({ text: '暂时无法读取归档信息。', error: true }); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  const storageAction = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setNotice(undefined);
    try { await action(); } catch { setNotice({ text: '保存操作暂时不可用，请重试。', error: true }); }
    finally {
      try { await refreshLibrary(); }
      catch { setNotice({ text: '归档列表刷新失败，请稍后重试；请以操作本身的保存回执为准。', error: true }); }
      finally { setBusy(false); }
    }
  };
  const chooseDirectory = async () => {
    const result = await window.clipnote.chooseLibrary();
    if (result.status === 'ok') { setLibrary(result.value); return true; }
    setNotice(result.status === 'cancelled' ? { text: '已取消目录选择' } : { text: result.error.message, error: true }); return false;
  };
  const saveSource = async () => {
    if (!document) return;
    if (!library.directory && !await chooseDirectory()) return;
    const result = await window.clipnote.saveSource(document.sourceId);
    if (result.status === 'ok') { setSavedVersion(result.value); setNotice({ text: '来源已保存，已创建独立版本。' }); }
    else if (result.status === 'error') setNotice({ text: result.error.message, error: true });
  };
  const resume = async (draftId: string) => {
    if (!library.directory && !await chooseDirectory()) return;
    const result = await window.clipnote.resumeSave(draftId);
    if (result.status === 'ok') { setSavedVersion(result.value); setNotice({ text: '保存重试完成。' }); }
    else if (result.status === 'error') setNotice({ text: result.error.message, error: true });
  };
  const openVersion = async (revision: SavedRevision) => {
    const result = await window.clipnote.openRevision(revision.sourceId, revision.revisionId);
    if (result.status === 'ok') { addDocument(result.value.document); setSavedVersion(result.value.revision); setNotice({ text: result.value.revision.noteModified ? '已打开来源；此版本的笔记有外部修改，将保留原样。' : '已从归档打开完整来源。' }); }
    else if (result.status === 'error') setNotice({ text: result.error.message, error: true });
  };
  const importFile = async () => {
    if (busy) return;
    setBusy(true); setNotice(undefined);
    try {
      const result = await window.clipnote.importSource();
      if (result.status === 'cancelled') { setNotice({ text: '已取消选择' }); return; }
      if (result.status === 'error') { setNotice({ text: result.error.message, error: true }); return; }
      const source = result.document;
      addDocument(source);
    } catch { setNotice({ text: '导入连接暂时不可用，请重试。', error: true }); }
    finally { setBusy(false); }
  };

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon size={21} /></span>ClipNote</div>
      <p className="brand-subtitle">让资料成为思路</p>
      <div className="nav-current"><Icon name="layers" size={17} />文件导入<span className="nav-dot" /></div>
      <p className="session-title">本次会话</p>
      <div className="session-files">
        {!documents.length && <p className="session-empty">导入的资料会显示在这里。<br />从一份字幕或文本开始。</p>}
        {documents.map(source => <button key={source.sourceId} disabled={busy} className={`session-file ${source.sourceId === activeId ? 'selected' : ''}`} onClick={() => selectDocument(source)} title={source.fileName}>
          <Icon size={16} /><span><b>{source.fileName}</b><small>{source.format.toUpperCase()} · {source.segments.length} 个片段</small></span>
        </button>)}
      </div>
      <LibrarySidebar library={library} busy={busy} onOpen={revision => void storageAction(() => openVersion(revision))} onResume={draftId => void storageAction(() => resume(draftId))} />
      <footer className="sidebar-footer"><div className="local-status"><i />本地工作台</div><p>未保存资料关闭后清空。<br />已归档版本可重新打开。</p></footer>
    </aside>
    <main className="desktop" aria-busy={busy}>
      <header className="toolbar"><div><p className="eyebrow">工作台 / 文件导入</p><h1 title={document?.fileName}>{document?.fileName ?? '文件导入'}</h1><p className="toolbar-caption">{document ? '保留来源，核对每一个片段。' : '把字幕与文本，带到同一个工作台。'}</p></div>
        <div className="toolbar-actions"><button className="secondary" disabled={busy || !document} onClick={() => void storageAction(saveSource)}>保存来源</button><button className="primary" disabled={busy} onClick={() => void importFile()}><Icon name="plus" size={16} />{busy ? '正在处理…' : '导入文件'}</button></div>
      </header>
      <div className="library-bar"><span title={library.directory ?? ''}>{library.directory ? `保存目录：${library.directory}` : '选择本地目录，归档后可在重启时重新打开。'}</span><button disabled={busy} onClick={() => void storageAction(async () => { await chooseDirectory(); })}>{library.directory ? '更改目录' : '选择保存目录'}</button></div>
      {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</div>}
      {!!library.warnings.length && <div className="library-warning" role="status">{library.warnings[0]}</div>}
      <div className="content-layout">
        <section className="workspace" aria-label="来源工作区">
          {!document ? <div className="welcome">
            <p className="eyebrow">从来源开始</p><h2>从一份资料开始。</h2><p className="intro">导入字幕或文本，查看内容与来源位置。<br />先把原文完整留下，再向下一步出发。</p>
            <div className="import-card"><div className="document-art"><Icon size={43} /></div><h3>选择字幕或文本</h3><p>支持带时间的字幕，也支持已有文字资料。</p>
              <button className="primary" disabled={busy} onClick={() => void importFile()}><Icon name="plus" size={17} />{busy ? '正在处理…' : '选择本地文件'}</button>
              <div className="formats">{['SRT', 'VTT', 'TXT', 'MD'].map(format => <span key={format}>{format}</span>)}</div><p className="size-note">单文件不超过 16 MiB</p>
            </div>
            <div className="benefits"><div className="benefit"><strong><Icon size={14} />保留原文</strong><p>原始内容与换行保持完整，<br />不会修改你选择的文件。</p></div><div className="benefit"><strong><Icon name="link" size={14} />按片段定位</strong><p>字幕对应真实时间，<br />文本对应原文行号。</p></div><div className="benefit"><strong><Icon name="shield" size={14} />本地处理</strong><p>导入和查看无需登录，<br />不向外部服务发送资料。</p></div></div>
          </div> : <>
            <div className="source-head"><span className="format-badge">{document.format.toUpperCase()}</span><span>{document.segments.length.toLocaleString()} 个来源片段 · {document.rawText.length.toLocaleString()} 字符 · {document.encoding.toUpperCase()}</span></div>
            <div className="view-tabs"><button className={view === 'segments' ? 'active' : ''} aria-pressed={view === 'segments'} onClick={() => setView('segments')}>来源片段</button><button className={view === 'raw' ? 'active' : ''} aria-pressed={view === 'raw'} onClick={openOriginal}>原始文本</button></div>
            {view === 'raw' ? <>
              {document.rawText.length > RAW_PREVIEW_LIMIT && <p className="preview-note">原文较长，分为 {Math.ceil(document.rawText.length / RAW_PREVIEW_LIMIT)} 页显示。当前为第 {rawStart + 1}–{rawEnd} 字符，内容未删减。</p>}
              <pre className="raw-source" data-testid="raw-source">{highlightStart < highlightEnd ? <>{document.rawText.slice(rawStart, highlightStart)}<mark ref={rawMark}>{document.rawText.slice(highlightStart, highlightEnd)}</mark>{document.rawText.slice(highlightEnd, rawEnd)}</> : document.rawText.slice(rawStart, rawEnd)}</pre>
              {document.rawText.length > RAW_PREVIEW_LIMIT && <div className="pagination"><button disabled={!rawPage} onClick={() => setRawPage(value => value - 1)}>上一页</button><span>原文第 {rawPage + 1} / {Math.ceil(document.rawText.length / RAW_PREVIEW_LIMIT)} 页</span><button disabled={rawEnd >= document.rawText.length} onClick={() => setRawPage(value => value + 1)}>下一页</button></div>}
            </> : <>
              <div className="source-list">{document.segments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item, index) => <button key={item.segmentId} className={`segment ${selected === page * PAGE_SIZE + index ? 'active' : ''}`} aria-label={`定位片段 ${item.order}`} aria-pressed={selected === page * PAGE_SIZE + index} onClick={() => setSelected(page * PAGE_SIZE + index)}>
                <div className="segment-meta"><span>片段 {String(item.order).padStart(2, '0')}</span><span className="time">{item.startMs !== undefined ? `${time(item.startMs)} — ${time(item.endMs!)}` : `第 ${item.range.startLine}–${item.range.endLine} 行`}</span></div>
                <p>{item.text.slice(0, 1000)}</p>{item.text.length > 1000 && <small>长片段，此处预览前 1,000 字符；完整内容见原始文本。</small>}
              </button>)}</div>
              {document.segments.length > PAGE_SIZE && <div className="pagination"><button disabled={!page} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page + 1} / {Math.ceil(document.segments.length / PAGE_SIZE)} 页 · 每页 {PAGE_SIZE} 个片段</span><button disabled={(page + 1) * PAGE_SIZE >= document.segments.length} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
            </>}
          </>}
        </section>
        <aside className="inspector"><h2>来源概览</h2>{!document ? <div className="inspector-placeholder"><Icon name="layers" size={33} /><p>导入后，在这里查看<br />文件信息与原文位置。</p></div> : <>
          <dl><dt>来源格式</dt><dd>{document.format.toUpperCase()} · 本地文件</dd><dt>文本编码</dt><dd>{document.encoding.toUpperCase()}</dd><dt>片段数量</dt><dd>{document.segments.length.toLocaleString()} 个</dd><dt>原始位置</dt><dd className="path">{document.originalPath}</dd><dt>来源校验</dt><dd className="path" title={document.checksum}>{document.checksum.slice(0, 16)}…</dd></dl>
          {savedVersion?.sourceId === document.sourceId && <div className="saved-location"><strong>已保存 · {savedVersion.kind === 'source-archive' ? '原文归档，未进行 AI 整理' : '笔记版本'}</strong><p>{savedVersion.notePath}</p></div>}
          <div className="inspector-divider" />
          {segment && <><h2>片段 {String(segment.order).padStart(2, '0')} · 原文依据</h2><p className="source-location" data-testid="source-location">第 {segment.range.startLine}–{segment.range.endLine} 行{segment.startMs !== undefined ? ` · ${time(segment.startMs)}` : ''}</p><pre className="excerpt">{segment.text.slice(0, 600)}</pre>{segment.text.length > 600 && <p className="preview-note">此处显示片段开头，完整内容见原始文本。</p>}<button className="original-link" onClick={openOriginal}>查看原文位置</button></>}
        </>}</aside>
      </div>
    </main>
  </div>;
}
