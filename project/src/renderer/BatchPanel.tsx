import {SubscriptionTaskPanel} from './SubscriptionTaskPanel.tsx';
import {OrganizationStatus} from './OrganizationStatus.tsx';
import type {ApiProfilesView} from '../contracts/api.ts';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {KeyboardEvent,PointerEvent} from 'react';
import type {BatchState,WorkspaceEntry,WorkspaceRoot,SavedResult,SavePreview} from '../contracts/workspace.ts';
import {unwrap,workspaceValue} from './workspace-api.ts';
import {FolderPicker} from './FolderPicker.tsx';
import {ToolButton} from './FileIcon.tsx';
const labels={queued:'等待',running:'正在整理',succeeded:'已保存',failed:'失败',cancelled:'已取消'};
const KEY='clipnote.analysis.instructions';
const HEIGHT_KEY='clipnote.analysis.panelHeight';
const DEFAULT_HEIGHT=332;
const MIN_HEIGHT=164;
// Reserve room for the divider, the source card and its bottom gutter.
const SOURCE_SPACE=180;

function readHeight(){
  try {
    const value=Number(window.localStorage.getItem(HEIGHT_KEY));
    if(Number.isFinite(value) && value>=MIN_HEIGHT)return value;
  } catch {}
  return DEFAULT_HEIGHT;
}
export function BatchPanel({ids,instructions,onBusy,openRequest=0,active=true,noticeCount=0}:{active?:boolean;noticeCount?:number;ids:string[];instructions:string;onBusy(value:boolean):void;openRequest?:number}){
  const [services,setServices]=useState<ApiProfilesView>({profiles:[]}),[profileId,setProfileId]=useState('');
  const [service,setService]=useState<'api'|'subscription'>('api');
  const [open,setOpen]=useState(false),[target,setTarget]=useState<WorkspaceEntry|WorkspaceRoot>(),[picker,setPicker]=useState(false),[batch,setBatch]=useState<BatchState>({status:'idle',items:[]}),[text,setText]=useState(instructions);
  const [working,setWorking]=useState(false),[error,setError]=useState(''),[failed,setFailed]=useState<string[]>([]),[results,setResults]=useState<SavedResult[]>([]),[pendingId,setPendingId]=useState<string>(),[preview,setPreview]=useState<SavePreview>(),[saveName,setSaveName]=useState('');
  const [preferredHeight,setPreferredHeight]=useState(readHeight);
  const [maxHeight,setMaxHeight]=useState(DEFAULT_HEIGHT);
  const [pendingRequest,setPendingRequest]=useState(0);
  const panel=useRef<HTMLElement>(null),content=useRef<HTMLDivElement>(null);
  const pendingSection=useRef<HTMLElement>(null);
  const drag=useRef<{pointerId:number;y:number;height:number}|null>(null);
  const minHeight=Math.min(MIN_HEIGHT,maxHeight);
  const height=Math.min(preferredHeight,maxHeight);
  const [linkPicker,setLinkPicker]=useState(false),[linkNote,setLinkNote]=useState<WorkspaceEntry>();
  const reload=async()=>setResults(unwrap(await window.clipnote.savedResults()));
  const run=async(fn:()=>Promise<void>)=>{if(working)return;setWorking(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作未完成。');}finally{setWorking(false);}};
  useEffect(()=>{void run(async()=>{await reload();const value=unwrap(await window.clipnote.batchState());setBatch(value);onBusy(value.status==='running');});},[]);
  const show=()=>void run(async()=>{setOpen(true);await reload();const root=await workspaceValue('notes','root');setTarget(root);setText(instructions);setProfileId('');});
  useEffect(()=>{if(openRequest)show();},[openRequest]);
  useEffect(()=>{if(batch.status!=='running')return;let alive=true;const timer=setInterval(()=>{void window.clipnote.batchState().then(async response=>{if(!alive)return;const value=unwrap(response);setBatch(value);if(value.status!=='running'){onBusy(false);await reload();}}).catch(()=>{if(alive)setError('无法读取整理状态，请稍后重试。');});},400);return()=>{alive=false;clearInterval(timer);};},[batch.status]);
  useEffect(()=>{
    if(!open||!active)return;
    let alive=true;
    void window.clipnote.apiProfiles().then(unwrap).then(value=>{
      if(!alive)return;
      setServices(value);setProfileId(id=>value.profiles.some(profile=>profile.id===id)?id:'');
    }).catch(error=>{if(alive)setError(error.message);});
    return()=>{alive=false;};
  },[open,active]);
  const prepare=()=>void run(async()=>{if(!target)return;if(ids.length>100)throw new Error('单批最多整理 100 份资料，请减少选择。');const config=services.profiles.find(value=>value.id===(profileId||services.defaultId));if(!config)throw new Error('请选择已配置的 API 服务。');setBatch(unwrap(await window.clipnote.batchPrepare(ids,target.id,{baseUrl:config.baseUrl,model:config.model,profile:{id:config.id,revision:config.revision},instructions:text})));});
  const start=()=>void run(async()=>{const value=unwrap(await window.clipnote.batchStart());setBatch(value);onBusy(value.status==='running');});
  const retry=(itemIds:string[])=>void run(async()=>{const value=unwrap(await window.clipnote.batchRetry(itemIds));setBatch(value);setFailed([]);onBusy(value.status==='running');});
  const recovering=(id:string)=>void run(async()=>{setPendingId(id);setSaveName(results.find(item=>item.id===id)?.name??'笔记.md');try{setPreview(unwrap(await window.clipnote.prepareResult(id)));}catch(e){setError((e instanceof Error?e.message:'原位置不可用。')+' 可选择其他文件夹保存。');}});
  const pick=(folder:WorkspaceEntry)=>{setPicker(false);if(pendingId)void run(async()=>setPreview(unwrap(await window.clipnote.prepareResult(pendingId,folder.id,saveName))));else setTarget(folder);};
  const running=batch.status==='running',ready=batch.status==='ready';
  const canConfigure=!running&&!ready;
  const done=batch.items.filter(item=>['succeeded','failed','cancelled'].includes(item.status)).length;
  const defaultProfile=services.profiles.find(profile=>profile.id===services.defaultId);

  useLayoutEffect(()=>{
    const region=panel.current,workspace=region?.parentElement;
    const toolbar=workspace?.querySelector(':scope > .toolbar');
    const summary=region?.querySelector('.batch-summary');
    if(!region||!workspace||!toolbar||!summary||!active||!open)return;
    const notices=Array.from(workspace.querySelectorAll(':scope > .notice'));
    const measure=()=>{
      if(!workspace.clientHeight)return;
      const reserved=notices.reduce((space,notice)=>space+notice.getBoundingClientRect().height+8,SOURCE_SPACE);
      const available=workspace.getBoundingClientRect().bottom-summary.getBoundingClientRect().bottom-reserved;
      setMaxHeight(Math.max(100,Math.floor(available)));
    };
    const observer=new ResizeObserver(measure);
    observer.observe(workspace);
    observer.observe(toolbar);
    observer.observe(summary);
    notices.forEach(notice=>observer.observe(notice));
    measure();
    return ()=>observer.disconnect();
  },[open,active,noticeCount]);

  useLayoutEffect(()=>{if(content.current)content.current.scrollTop=0;},[open,batch.status]);
  useLayoutEffect(()=>{if(pendingRequest)pendingSection.current?.focus();},[pendingRequest]);

  const resize=(next:number,save=false)=>{
    const value=Math.round(Math.max(minHeight,Math.min(maxHeight,next)));
    setPreferredHeight(value);
    if(save){try{window.localStorage.setItem(HEIGHT_KEY,String(value));}catch{}}
  };
  const dragStart=(event:PointerEvent<HTMLDivElement>)=>{
    if(!event.isPrimary||event.button!==0)return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={pointerId:event.pointerId,y:event.clientY,height};
  };
  const dragMove=(event:PointerEvent<HTMLDivElement>,save=false)=>{
    const start=drag.current;
    if(start?.pointerId!==event.pointerId)return;
    if(save)drag.current=null;
    resize(start.height+event.clientY-start.y,save);
  };
  const resizeByKey=(event:KeyboardEvent<HTMLDivElement>)=>{
    const next={ArrowUp:height-16,ArrowDown:height+16,Home:minHeight,End:maxHeight}[event.key];
    if(next===undefined)return;
    event.preventDefault();
    resize(next,true);
  };

  return <section ref={panel} className="batch-panel" aria-label="批量整理">
    <div className="batch-summary">
      <button className="secondary" disabled={!ids.length || running || working} onClick={show}>批量整理（{ids.length}）</button>
      {running && <button className="secondary" onClick={()=>setOpen(value=>!value)}>整理进度 · {done}/{batch.items.length} 份</button>}
      {results.length>0 && <button className="secondary" onClick={()=>{setOpen(true);setPendingRequest(value=>value+1);}}>待保存结果（{results.length}）</button>}
    </div>
    {open && <>
      <div className="batch-detail" style={{height}} id="organize-panel-content">
        <header>
          <div>
            <h2>AI 整理</h2>
            <p>{running?'进度会持续更新，可以继续查看资料。':ready?'请核对发送对象和笔记位置。':ids.length===1?'已选 1 份资料 · 整理后生成 Markdown 笔记':`已选 ${ids.length} 份资料 · 每份分别生成笔记`}</p>
          </div>
          <ToolButton label="收起整理面板" icon="close" onClick={()=>setOpen(false)}/>
        </header>
        <div className="batch-body" ref={content}>
          {ready && <section className="batch-confirm" aria-label="确认发送资料">
            <h3>确认发送并保存</h3>
            <dl>
              <div><dt>发送至</dt><dd>{batch.serviceName && <strong>{batch.serviceName} · </strong>}{batch.baseUrl}</dd></div>
              <div><dt>模型</dt><dd>{batch.model}</dd></div>
            </dl>
            <p>将发送 {batch.items.length} 份资料。服务可能按请求计费。同批内容和配置相同的资料共享整理结果，各自保存。</p>
            <ul>{batch.items.map(item=><li key={item.id}><b>{item.name}</b><span>{item.outputPath??item.outputName}</span>{item.overwrite && <em>将覆盖已关联笔记</em>}</li>)}</ul>
          </section>}
          {['running','done','cancelled'].includes(batch.status) && <section className="batch-queue" aria-label="整理队列">
            {batch.items.length>1 && <label className="batch-progress">
              <strong>已处理 {done}/{batch.items.length} 份</strong>
              <span>成功 {batch.items.filter(item=>item.status==='succeeded').length} · 失败 {batch.items.filter(item=>item.status==='failed').length} · 取消 {batch.items.filter(item=>item.status==='cancelled').length}</span>
              <progress value={done} max={batch.items.length}/>
            </label>}
            {batch.items.map(item=><div className={'batch-item '+item.status} key={item.id}>
              {batch.items.length>1 && item.status==='failed' && <input type="checkbox" aria-label={'重试 '+item.name} checked={failed.includes(item.id)} onChange={event=>setFailed(old=>event.target.checked?[...old,item.id]:old.filter(id=>id!==item.id))}/>}
              <div>
                <b>{item.name}</b>
                <OrganizationStatus id={item.diagnosticId} fallback={labels[item.status]} error={item.error} timing={item.timing}/>
                {item.reused && <small>已复用本批整理结果。</small>}
                {item.canRetrySave && <small>生成内容已保留，可在待保存结果中继续。</small>}
                {batch.items.length===1 && item.status==='failed' && !item.canRetrySave && !running && <button className="secondary" disabled={working} onClick={()=>retry([item.id])}>重试整理</button>}
              </div>
            </div>)}
            {batch.items.length>1 && !running && <button className="secondary" disabled={!failed.length || working} onClick={()=>retry(failed)}>重试选中失败项</button>}
          </section>}
          {results.length>0 && <section ref={pendingSection} tabIndex={-1} className="pending-results" aria-label="待保存结果">
            <h3>待保存结果</h3>
            <p>保存已生成的笔记，无需再次请求 AI。</p>
            {results.map(item=><div key={item.id}><span>{item.name}</span><button className="secondary" disabled={working || running} onClick={()=>recovering(item.id)}>恢复保存</button></div>)}
          </section>}
          {canConfigure && <>
            <div className="batch-fields">
              <label>整理服务<select aria-label="整理服务" value={service} onChange={event=>setService(event.target.value as 'api'|'subscription')}><option value="api">API 服务</option><option value="subscription">ChatGPT 订阅</option></select></label>
              {service==='api' && services.profiles.length>0 && <label>本次使用的 API 服务<select value={profileId} disabled={working} onChange={event=>setProfileId(event.target.value)}><option value="">{defaultProfile?'默认 · '+defaultProfile.name:'请选择服务'}</option>{services.profiles.map(value=><option key={value.id} value={value.id}>{value.name} · {value.model}</option>)}</select></label>}
            </div>
            <div className="batch-target">
              <div><small>新笔记保存到</small><p title={target && 'path' in target?target.path:undefined}>{target?.name??'请选择笔记文件夹'}</p></div>
              <button className="secondary" disabled={working} onClick={()=>{setPendingId(undefined);setPicker(true);}}>{target?'更改位置':'选择笔记文件夹'}</button>
            </div>
            <details className="batch-options">
              <summary>补充要求与笔记选项</summary>
              <label>补充整理要求 <small>（可选）</small><textarea aria-label="补充整理要求" maxLength={1000} value={text} disabled={working} onChange={event=>setText(event.target.value)} placeholder="例如：整理成操作步骤，保留示例"/></label>
              <div className="batch-actions">
                <button className="quiet" onClick={()=>{try{window.localStorage.setItem(KEY,text);setError('补充要求已保存到本机。');}catch{setError('无法保存补充要求。');}}}>保存补充要求</button>
                <button className="quiet" onClick={()=>{setText('');try{window.localStorage.removeItem(KEY);}catch{setError('无法保存默认要求。');}}}>恢复默认</button>
                {ids.length===1 && <button className="quiet" onClick={()=>setLinkPicker(true)}>关联已有笔记</button>}
              </div>
            </details>
          </>}
          {service==='subscription' && ids.length===1 && target && <SubscriptionTaskPanel id={ids[0]} folder={target.id} instructions={text} onDone={()=>void reload()}/>}
          {service==='subscription' && ids.length!==1 && <p className="batch-message">请选中一份资料后使用订阅整理。</p>}
        </div>
        <footer>
          {error && <p role="status" className="batch-message">{error}</p>}
          <div className="batch-next">
            {ready && <><button className="secondary" onClick={()=>setBatch({status:'idle',items:[]})}>取消</button><button className="primary" disabled={working} onClick={start}>确认发送并开始</button></>}
            {running && <button className="secondary" onClick={()=>void run(async()=>{unwrap(await window.clipnote.batchCancel());})}>停止批量整理</button>}
            {service==='api' && canConfigure && <><small>{!target?'先选择笔记保存位置。':!defaultProfile&&!profileId?'请先在设置中配置 API 服务。':'下一步核对发送对象和保存位置。'}</small><button className="primary" disabled={!target || (!defaultProfile && !profileId) || !ids.length || ids.length>100 || working} onClick={prepare}>检查所选文件</button></>}
          </div>
        </footer>
      </div>
      <div className="batch-height-handle" role="separator" tabIndex={0} aria-label="调整 AI 整理面板高度" aria-orientation="horizontal" aria-controls="organize-panel-content" aria-valuemin={minHeight} aria-valuemax={maxHeight} aria-valuenow={height} aria-valuetext={height+' 像素'}
        onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={event=>dragMove(event,true)} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={resizeByKey}/>
    </>}
    {picker && <FolderPicker kind="notes" chooseRoot title={pendingId?'选择结果保存位置':'选择笔记保存位置'} onPick={pick} onCancel={()=>setPicker(false)}/>}
    {linkPicker && <FolderPicker kind="notes" title="选择关联笔记" onPick={()=>{}} onPickFile={file=>{setLinkNote(file);setLinkPicker(false);}} onCancel={()=>setLinkPicker(false)}/>}
    {linkNote && <div className="file-dialog-shade"><section className="file-dialog" role="dialog" aria-modal="true" aria-label="确认关联笔记"><h3>关联「{linkNote.name}」？</h3><p>将当前资料与这份笔记建立关联。之后重新整理仍会先确认覆盖。</p><footer><button className="secondary" onClick={()=>setLinkNote(undefined)}>取消</button><button className="primary" disabled={working} onClick={()=>void run(async()=>{await workspaceValue('source','associate',ids[0],linkNote.id);setLinkNote(undefined);setBatch({status:'idle',items:[]});setError('笔记已关联，整理前仍会确认覆盖。');})}>确认关联</button></footer></section></div>}
    {pendingId && !picker && <div className="file-dialog-shade"><section className="file-dialog" role="dialog" aria-modal="true" aria-label="恢复保存结果"><h3>保存已生成的笔记</h3><label>另存文件名<input aria-label="结果文件名" value={saveName} onChange={event=>{setSaveName(event.target.value);setPreview(undefined);}}/></label>{preview && <p>{preview.path}{preview.overwrite?'（将覆盖）':''}</p>}<p>{error}</p><footer><button className="secondary" onClick={()=>{setPendingId(undefined);setPreview(undefined);}}>取消</button><button className="secondary" onClick={()=>{setPreview(undefined);setPicker(true);}}>选择其他位置</button><button className="primary" disabled={!preview || working} onClick={()=>void run(async()=>{unwrap(await window.clipnote.saveResult(preview!.token));setPendingId(undefined);setPreview(undefined);await reload();setBatch(unwrap(await window.clipnote.batchState()));setError('结果已保存。');})}>确认保存结果</button></footer></section></div>}
  </section>;
}
