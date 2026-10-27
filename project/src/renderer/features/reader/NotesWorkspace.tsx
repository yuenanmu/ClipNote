import type { NoteEntry, ReaderDocument } from '../../../contracts/reader.ts';
import type { SavedRevision } from '../../../contracts/storage.ts';
import { ReaderView } from './ReaderView.tsx';
import './reader.css';
export interface NotesWorkspaceProps {
  document?: ReaderDocument; entries: NoteEntry[]; revisions: SavedRevision[]; busy: boolean; notice?: { text: string; error?: boolean };
  onAdd(): void; onOpen(id: string): void; onRemove(id: string): void; onRelink(id: string): void; onListRefresh(): void;
  onRevision(revision: SavedRevision): void; onBack(): void; onRefresh(): void; onExternal(): void; onExternalLink(url: string): void; onSource(segmentId?: string): void;
}
export function NotesWorkspace(props: NotesWorkspaceProps) {
  const navigation = <section className="note-navigation" aria-label="笔记列表"><div className="note-list-title"><strong>笔记</strong><button disabled={props.busy} onClick={props.onListRefresh} aria-label="刷新笔记列表" title="刷新笔记列表">↻</button></div>
    <div className="note-list"><p className="note-group-title">我的 Markdown · {props.entries.length}</p>
      {!props.entries.length && <p className="session-empty">添加已有 MD，重启后继续阅读。</p>}
      {props.entries.map(entry => <div key={entry.noteId} className={`note-entry ${entry.noteId === props.document?.noteId ? 'selected' : ''}`}>
        <button className="note-open" disabled={props.busy} aria-label={`打开笔记 ${entry.fileName}`} title={entry.filePath} onClick={() => props.onOpen(entry.noteId)}><b>{entry.fileName}</b><small>{entry.available ? '本地文件' : '文件不可用'}</small></button>
        <div className="note-entry-actions"><button disabled={props.busy} onClick={() => props.onRelink(entry.noteId)} aria-label={`重新关联 ${entry.fileName}`}>重新关联</button><button disabled={props.busy} onClick={() => props.onRemove(entry.noteId)} aria-label={`移出笔记列表 ${entry.fileName}`} title="仅移除登记，原文件保留">移出列表</button></div>
      </div>)}
      {!!props.revisions.length && <><p className="note-group-title">已归档笔记 · {props.revisions.length}</p>{props.revisions.map(revision => <div className={`note-entry ${props.document?.archive?.revisionId === revision.revisionId ? 'selected' : ''}`} key={revision.revisionId}><button className="note-open" disabled={props.busy} onClick={() => props.onRevision(revision)} aria-label={`阅读归档笔记 ${revision.title}，版本 ${revision.revisionId.slice(0, 8)}`} title={revision.notePath}><b>{revision.title}</b><small>{revision.kind === 'source-archive' ? '来源归档' : '生成笔记'} · {new Date(revision.createdAt).toLocaleDateString('zh-CN')} · {revision.revisionId.slice(0, 8)}</small></button></div>)}</>}
    </div>
  </section>;
  if (props.document) return <ReaderView document={props.document} navigation={navigation} busy={props.busy} notice={props.notice} onOpen={props.onAdd} onBack={props.onBack} onRefresh={props.onRefresh} onExternal={props.onExternal} onExternalLink={props.onExternalLink} onSource={props.onSource} />;
  return <div className="reader-shell"><aside className="reader-outline"><div className="reader-brand">ClipNote<span>笔记与思路</span></div><button className="reader-back" disabled={props.busy} aria-label="返回文件工作台" onClick={props.onBack}>← 返回文件工作台</button>{navigation}<p className="reader-offline">本地阅读 · 无需登录</p></aside><main className="reader-main"><header className="reader-toolbar"><div><p className="eyebrow">工作台 / 笔记</p><h1>笔记</h1></div><button className="primary" disabled={props.busy} onClick={props.onAdd}>添加 Markdown</button></header>{props.notice && <div className={`notice ${props.notice.error ? 'error' : ''}`} role={props.notice.error ? 'alert' : 'status'}>{props.notice.text}</div>}<div className="notes-empty"><span>文档 → 思路</span><h2>让层级关系清楚起来。</h2><p>添加已有 Markdown，或从左侧选择归档笔记。<br />用 Mindmap 浏览主干，回到 Markdown 阅读细节。</p><button className="secondary" disabled={props.busy} onClick={props.onAdd}>选择一份笔记</button><small>文件保留在原位置 · 列表可跨重启保留</small></div></main></div>;
}
