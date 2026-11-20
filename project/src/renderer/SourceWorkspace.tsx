import {useEffect,useRef,useState} from 'react';
import type {SourceDocument} from '../contracts/source.ts';
import {FileIcon as Icon} from './FileIcon.tsx';
const PAGE_SIZE=100,RAW_PREVIEW_LIMIT=200_000;
function time(ms:number){const total=Math.floor(ms/1000),hours=Math.floor(total/3600);return `${hours?String(hours).padStart(2,'0')+':':''}${String(Math.floor(total/60)%60).padStart(2,'0')}:${String(total%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;}
export function SourceWorkspace({document,importFile,busy=false}:{document?:SourceDocument;importFile():Promise<void>;busy?:boolean}){
  const [selected,setSelected]=useState(0),[view,setView]=useState<'segments'|'raw'>('segments'),[page,setPage]=useState(0),[rawPage,setRawPage]=useState(0);
  const rawMark=useRef<HTMLElement>(null),segment=document?.segments[selected],rawStart=rawPage*RAW_PREVIEW_LIMIT,rawEnd=Math.min(rawStart+RAW_PREVIEW_LIMIT,document?.rawText.length??0);
  const highlightStart=Math.max(rawStart,segment?.range.startOffset??rawStart),highlightEnd=Math.min(rawEnd,segment?.range.endOffset??rawStart);
  useEffect(()=>{setSelected(0);setPage(0);setRawPage(0);setView('segments');},[document?.sourceId]);
  useEffect(()=>{if(view==='raw')rawMark.current?.scrollIntoView({block:'center'});},[view,selected,rawPage]);
  const openOriginal=()=>{setRawPage(Math.floor((segment?.range.startOffset??0)/RAW_PREVIEW_LIMIT));setView('raw');};
  return (
      <div className="content-layout">
        <section className="workspace" aria-label="来源工作区">
          {!document ? <div className="welcome">
            <div className="import-card">
              <div className="document-art"><Icon size={30} /></div>
              <h2>导入本地资料</h2>
              <p>打开字幕、文本或 Markdown，按时间或行号查找原文。</p>
              <button className="primary" disabled={busy} onClick={() => void importFile()}><Icon name="plus" size={17} />{busy ? '正在处理…' : '选择本地文件'}</button>
              <p className="size-note">SRT、VTT、TXT、MD · 单文件不超过 16 MiB</p>
            </div>
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
        <aside className="inspector"><h2>来源概览</h2>{!document ? <div className="inspector-placeholder"><Icon name="layers" size={33} /><p>打开文件后可查看格式、路径和所选片段。</p></div> : <>
          <dl><dt>来源格式</dt><dd>{document.format.toUpperCase()} · 本地文件</dd><dt>文本编码</dt><dd>{document.encoding.toUpperCase()}</dd><dt>片段数量</dt><dd>{document.segments.length.toLocaleString()} 个</dd><dt>原始位置</dt><dd className="path">{document.originalPath}</dd><dt>来源校验</dt><dd className="path" title={document.checksum}>{document.checksum.slice(0, 16)}…</dd></dl>
          <div className="inspector-divider" />
          {segment && <><h2>片段 {String(segment.order).padStart(2, '0')} · 原文依据</h2><p className="source-location" data-testid="source-location">第 {segment.range.startLine}–{segment.range.endLine} 行{segment.startMs !== undefined ? ` · ${time(segment.startMs)}` : ''}</p><pre className="excerpt">{segment.text.slice(0, 600)}</pre>{segment.text.length > 600 && <p className="preview-note">此处显示片段开头，完整内容见原始文本。</p>}<button className="original-link" onClick={openOriginal}>查看原文位置</button></>}
        </>}</aside>
      </div>
  );
}
