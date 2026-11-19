import {useState} from 'react';
import type {SmartSubSource,VideoQueueAction,VideoQueueItem,VideoQueueView,VideoStage,VideoSubtitlePreview} from '../contracts/smartsub.ts';
import {unwrap} from './workspace-api.ts';

const status:Record<VideoStage,string>={
  queued:'等待获取字幕',downloading:'正在获取字幕', 'waiting-transcription':'等待本机转写',
  transcribing:'正在转写',blocked:'待处理',ready:'可查看',failed:'失败',cancelled:'已取消',
};
const isActive=(stage:VideoStage)=>stage==='downloading'||stage==='transcribing';
const isTerminal=(stage:VideoStage)=>stage==='ready'||stage==='failed'||stage==='cancelled';
export function queueCounts(state:VideoQueueView){
  return {
    active:state.items.filter(item=>isActive(item.stage)).length,
    waiting:state.items.filter(item=>!isActive(item.stage)&&!isTerminal(item.stage)).length,
  };
}

function SubtitleResult({item,onSource}:{item:VideoQueueItem;onSource(source:SmartSubSource):void}){
  const [expanded,setExpanded]=useState(false),[index,setIndex]=useState(0);
  const [preview,setPreview]=useState<VideoSubtitlePreview>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const run=async(work:()=>Promise<void>)=>{
    setBusy(true);setError('');
    try{await work();}catch(error){setError(error instanceof Error?error.message:'无法读取字幕。');}
    finally{setBusy(false);}
  };
  const load=(next:number)=>void run(async()=>{
    setPreview(undefined);setIndex(next);
    setPreview(unwrap(await window.clipnote.videoSubtitlePreview(item.id,next)));
  });
  return <div className="video-result">
    <button className="secondary" aria-expanded={expanded} disabled={busy} onClick={()=>{
      setExpanded(!expanded);if(!expanded&&!preview)load(index);
    }}>{expanded?'收起预览':'预览字幕'}</button>
    <button className="primary" disabled={busy} onClick={()=>void run(async()=>onSource(unwrap(await window.clipnote.videoSubtitleOpen(item.id,index))))}>打开原文</button>
    {expanded && <div className="subtitle-preview">
      {item.subtitleCount>1 && <label>选择字幕<select value={index} disabled={busy} onChange={event=>load(Number(event.target.value))}>
        {Array.from({length:item.subtitleCount},(_,number)=><option key={number} value={number}>字幕 {number+1}</option>)}
      </select></label>}
      {busy && <p role="status">正在读取字幕…</p>}
      {preview && <><strong>{preview.name}</strong><span>{preview.format.toUpperCase()}</span>
        <p>{preview.lines.join('\n')}</p></>}
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function VideoQueuePanel({queue,error,onAction,onSettings,onSingle,onSource}:{
  queue:VideoQueueView;error:string;onAction(action:VideoQueueAction):Promise<void>;
  onSettings():void;onSingle():void;onSource(source:SmartSubSource):void;
}){
  const [links,setLinks]=useState(''),[autoTranscribe,setAutoTranscribe]=useState(true),[busy,setBusy]=useState(false),[localError,setLocalError]=useState('');
  const {active,waiting}=queueCounts(queue);
  const finished=queue.items.filter(item=>isTerminal(item.stage)).length;
  const run=async(action:VideoQueueAction)=>{
    setBusy(true);setLocalError('');
    try{await onAction(action);if(action.type==='add')setLinks('');}
    catch(error){setLocalError(error instanceof Error?error.message:'操作未完成。');}
    finally{setBusy(false);}
  };
  return <main className="desktop video-queue-desktop">
    <header className="toolbar"><div><p className="eyebrow">资料 / 视频队列</p><h1>视频队列</h1></div>
      <div className="toolbar-actions"><button className="secondary" onClick={onSettings}>SmartSub 设置</button><button className="secondary" onClick={onSingle}>单链接与旧任务</button></div>
    </header>
    <div className="video-queue-body">
      <section className="video-composer">
        <label>批量链接<textarea value={links} rows={3} maxLength={100000} onChange={event=>setLinks(event.target.value)} placeholder="每行粘贴一个视频链接"/></label>
        <label className="video-auto"><input type="checkbox" checked={autoTranscribe} onChange={event=>setAutoTranscribe(event.target.checked)}/>无字幕时，用当前配置的本机模型转写</label>
        <div className="video-actions">
          <button className="primary" disabled={busy||!links.trim()} onClick={()=>void run({type:'add',links,autoTranscribe})}>{queue.paused?'添加到队列':'确认并开始获取字幕'}</button>
          {queue.paused && <button className="secondary" disabled={busy} onClick={()=>void run({type:'resume'})}>继续队列</button>}
        </div>
        {(localError||error) && <p role="alert" className="notice error">{localError||error}</p>}
      </section>
      <section aria-label="视频任务列表">
        <header className="video-queue-summary"><h2>任务</h2><span>进行中 {active} · 待处理 {waiting} · 已结束 {finished}</span></header>
        {queue.paused && <p>正在恢复已提交的任务。待处理项将在继续队列后开始。</p>}
        {queue.items.length===0 && <p className="video-empty">添加视频链接后，这里会显示字幕和转写结果。</p>}
        <ul className="video-queue-list">{queue.items.map(item=><li className="video-queue-row" key={item.id}>
          <div className="video-row-title"><strong title={item.label}>{item.label}</strong><span className={`video-stage ${item.stage}`}>{item.cancelRequested?'等待取消':status[item.stage]}</span></div>
          {item.message && <p>{item.message}</p>}
          {item.stage==='ready' && <SubtitleResult item={item} onSource={onSource}/>}
          <div className="video-actions">
            {isActive(item.stage) && <button className="secondary" disabled={busy} onClick={()=>void run({type:'refresh',id:item.id})}>{item.needsRecovery?'恢复原任务':'重新查询'}</button>}
            {!isTerminal(item.stage) && <button className="quiet" disabled={busy||item.cancelRequested} onClick={()=>void run({type:'cancel',id:item.id})}>取消任务</button>}
            {(item.stage==='failed'||item.stage==='blocked') && <button className="secondary" disabled={busy} onClick={()=>void run({type:'retry',id:item.id})}>{item.stage==='blocked'?'确认并使用当前模型':'重试'}</button>}
            {isTerminal(item.stage)&&<button className="quiet" disabled={busy} onClick={()=>void run({type:'remove',id:item.id})}>移出列表</button>}
          </div>
        </li>)}</ul>
      </section>
    </div>
  </main>;
}
