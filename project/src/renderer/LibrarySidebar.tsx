import type { LibraryState, SavedRevision } from '../contracts/storage.ts';
export function LibrarySidebar({ library, busy, onOpen, onResume }: { library: LibraryState; busy: boolean; onOpen(revision: SavedRevision): void; onResume(draftId: string): void }) {
  return <>
    <p className="session-title library-title">已保存版本 <span>{library.revisions.length}</span></p>
    <div className="library-versions">
      {!library.revisions.length && <p className="session-empty">保存来源后，重启也能重新打开。</p>}
      {library.revisions.slice(0, 100).map(revision => <button className="session-file saved-file" key={revision.revisionId} disabled={busy} aria-label={`打开归档 ${revision.title}，版本 ${revision.revisionId.slice(0,8)}`} onClick={() => onOpen(revision)}>
        <span><b>{revision.title}</b><small>{revision.kind === 'source-archive' ? '来源归档' : '笔记版本'} · {new Date(revision.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>{revision.noteModified && <em>已外部修改</em>}</span>
      </button>)}
      {library.revisions.length > 100 && <p className="session-empty">显示最近100个版本。</p>}
    </div>
    {!!library.drafts.length && <><p className="session-title recovery-title">待完成保存</p><div className="recovery-list">{library.drafts.map(draft => <div className="recovery-card" key={draft.draftId}><span title={draft.title}>{draft.title}</span><button disabled={busy} aria-label={`重试保存 ${draft.title}`} onClick={() => onResume(draft.draftId)}>重试保存</button></div>)}</div></>}
  </>;
}
