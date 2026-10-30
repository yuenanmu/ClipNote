import {useEffect,useRef,useState} from 'react';
import type {SmartSubDiscovery,SmartSubReadiness,SmartSubSource,SmartSubTaskView,SmartSubTranscriptionReadiness} from '../contracts/smartsub.ts';
import {unwrap} from './workspace-api.ts';
import {observeSmartSubTask} from './smartsub-observer.ts';
import './smartsub.css';

export function SmartSubPanel({onBack,onSource,onSettings,active}:{onBack():void;onSettings():void;active:boolean;onSource(value:SmartSubSource):void}){
  const [state,setState]=useState<SmartSubDiscovery>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [url,setUrl]=useState(''),[id,setId]=useState(()=>{try{return localStorage.getItem('clipnote.smartsub.task')??'';}catch{return '';}}),[task,setTask]=useState<SmartSubTaskView>();
  const [readiness,setReadiness]=useState<SmartSubReadiness>();
  const [transcription,setTranscription]=useState<SmartSubTranscriptionReadiness>(),[transcriptionTask,setTranscriptionTask]=useState<SmartSubTaskView>(),[transcriptionStarted,setTranscriptionStarted]=useState(()=>{try{return localStorage.getItem('clipnote.smartsub.transcribing')==='yes';}catch{return false;}});
  const [forgetting,setForgetting]=useState(false);
  const [observationError,setObservationError]=useState(''),[observationAttempt,setObservationAttempt]=useState(0);
  const observer=useRef<ReturnType<typeof observeSmartSubTask>|undefined>(undefined);
  useEffect(()=>{if(!id)return;let alive=true,video:SmartSubTaskView|undefined;
    const stop=observeSmartSubTask(async()=>{
    if(video?.status!=='completed')video=unwrap(await window.clipnote.smartsubRefresh(id));
    if(alive)setTask(video);
    const transcription=transcriptionStarted?unwrap(await window.clipnote.smartsubTranscriptionRefresh(id)):undefined;
    return {status:transcription?.status??video.status,video,transcription};
  },value=>{setTask(value.video);if(value.transcription)setTranscriptionTask(value.transcription);setObservationError('');},()=>setObservationError('暂时无法更新任务状态，正在自动重连；后台任务可能仍在运行，请勿重复提交。'));observer.current=stop;return()=>{alive=false;stop();observer.current=undefined;};},[id,transcriptionStarted,observationAttempt]);
  const refresh=async()=>{const result=await window.clipnote.smartsubState();setState(unwrap(result));};
  useEffect(()=>{if(active)void refresh().catch(()=>setError('无法检查 SmartSub 安装，请到设置中重新检测。'));},[active]);
  useEffect(()=>{let alive=true;setReadiness(undefined);if(state?.installed)void window.clipnote.smartsubReadiness().then(value=>{if(alive)setReadiness(unwrap(value));}).catch(()=>{if(alive)setError('无法启动 SmartSub CLI，请检查安装和程序权限。');});return()=>{alive=false;};},[state]);
  useEffect(()=>{let alive=true;if(active && id && task?.status==='completed' && !task.hasSubtitles && !transcriptionStarted){setTranscription(undefined);void window.clipnote.smartsubTranscriptionReady(id).then(result=>{if(alive)setTranscription(unwrap(result));}).catch(()=>{if(alive)setError('暂时无法检查转写资源，请重试或到设置中重新检测。');});}return()=>{alive=false;};},[active,id,task?.status,task?.hasSubtitles,transcriptionStarted]);
  const execute=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'任务未完成，请重试。');}finally{setBusy(false);}};
  const prepare=()=>void execute(async()=>{const prepared=unwrap(await window.clipnote.smartsubPrepare(url));setId(prepared.requestId);setTranscriptionStarted(false);setTranscription(undefined);setTranscriptionTask(undefined);try{localStorage.setItem('clipnote.smartsub.task',prepared.requestId);localStorage.removeItem('clipnote.smartsub.transcribing');}catch{}setTask(undefined);setTask(unwrap(await window.clipnote.smartsubSubmit(prepared.requestId,url)));});
  const refreshTask=()=>observer.current?.refresh();
  const resume=()=>void execute(async()=>setTask(unwrap(await window.clipnote.smartsubSubmit(id,url))));
  const cancel=()=>void execute(async()=>setTask(unwrap(await window.clipnote.smartsubCancel(id))));
  const importSource=(index:number)=>void execute(async()=>onSource(unwrap(await window.clipnote.smartsubImportSubtitle(id,index))));
  const checkTranscription=()=>void execute(async()=>setTranscription(unwrap(await window.clipnote.smartsubTranscriptionReady(id))));
  const startTranscription=()=>void execute(async()=>{if(!transcription?.ready)return;const retry=Boolean(transcriptionTask && ['failed','cancelled','interrupted'].includes(transcriptionTask.status));setTranscriptionStarted(true);setTranscriptionTask(undefined);try{localStorage.setItem('clipnote.smartsub.transcribing','yes');}catch{}try{setTranscriptionTask(unwrap(await (retry?window.clipnote.smartsubTranscriptionRetry(id,transcription.engine,transcription.model):window.clipnote.smartsubTranscribe(id,transcription.engine,transcription.model))));}finally{if(retry)setObservationAttempt(value=>value+1);}});
  const refreshTranscription=refreshTask;
  const cancelTranscription=()=>void execute(async()=>setTranscriptionTask(unwrap(await window.clipnote.smartsubTranscriptionCancel(id))));
  const importTranscription=(index:number)=>void execute(async()=>onSource(unwrap(await window.clipnote.smartsubTranscriptionImport(id,index))));
  const forget=()=>{try{localStorage.removeItem('clipnote.smartsub.task');localStorage.removeItem('clipnote.smartsub.transcribing');}catch{}setId('');setTask(undefined);setTranscription(undefined);setTranscriptionTask(undefined);setTranscriptionStarted(false);setForgetting(false);setError('');};
  const labels:Record<string,string>={queued:'等待中',running:'正在获取字幕',paused:'已暂停',review:'等待处理',cancelling:'正在取消',completed:'获取完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
  const terminal=(value:SmartSubTaskView|undefined)=>Boolean(value && ['completed','failed','cancelled','interrupted'].includes(value.status));
  const transcribing=transcriptionStarted && !terminal(transcriptionTask);
  const canStart=!busy && Boolean(url.trim()) && readiness?.compatible && Boolean(readiness.downloaders.length) && (!id || terminal(task)) && !transcribing;
  const transcriptionLabel=transcriptionTask?.status==='running'?'正在转写':transcriptionTask?.status==='completed'?'转写完成':transcriptionTask?labels[transcriptionTask.status]:'正在确认提交状态';
  return <main className="desktop smartsub-desktop"><header className="toolbar"><div><p className="eyebrow">资料 / 视频链接</p><h1>视频链接</h1><p className="toolbar-caption">获取字幕，再整理成自己的笔记。</p></div><button className="secondary" onClick={onBack}>返回资料</button></header>
    <div className="workspace smartsub-workspace">
      <div className="smartsub-connection"><span>{readiness?`SmartSub ${readiness.version} · ${readiness.compatible?'已连接':'接口不兼容'}`:state?.installed?'正在连接 SmartSub…':state?'尚未找到 SmartSub':'正在检查连接…'}</span><button className="secondary" onClick={onSettings}>SmartSub 设置</button></div>
      {error && <p className="notice error" role="alert">{error}</p>}{observationError && <p className="notice" role="status">{observationError}</p>}
      <section className="smartsub-card"><h2>从链接获取资料</h2><p>优先获取已有字幕；没有字幕时，再由你确认是否转写。</p>
        <label>视频链接<input type="url" value={url} onChange={event=>setUrl(event.target.value)} placeholder="粘贴视频链接" disabled={busy}/></label>
        <p>开始后 SmartSub 会访问该链接，并将视频和字幕下载到本机。播放列表可能包含多个视频，下载大小未知；支持的网站以 SmartSub 为准。</p>
        <button className="primary" disabled={!canStart} onClick={prepare}>{busy && !id?'正在准备…':'确认并开始获取字幕'}</button>
        {!state?.installed && <p>请先到 SmartSub 设置中连接已有安装。</p>}{readiness && !readiness.downloaders.length && <p>缺少下载组件，请在 SmartSub 中确认安装后，到设置中重新检测。</p>}
        {id && <section className="task-card" aria-label="视频任务">
          <h2>任务：{task?labels[task.status]:'正在确认提交状态'}</h2><p>状态自动更新，切换到资料、笔记或设置后仍会继续跟踪。</p>
          {task && !terminal(task) && <button className="secondary" disabled={busy} onClick={cancel}>取消此任务</button>}
          {task?.status==='completed' && (task.subtitleCount?Array.from({length:task.subtitleCount},(_,index)=><p key={index}><button className="primary" disabled={busy} onClick={()=>importSource(index)}>使用字幕 {index+1}</button></p>):task.hasSubtitles?<p>已找到字幕，但格式暂不支持。请在 SmartSub 中转换为 SRT 或 VTT。</p>:<div><p>没有找到可用字幕，可以使用 SmartSub 的本地引擎转写。</p>
            {!transcriptionStarted && <button className="secondary" disabled={busy || !readiness?.transcriptionCompatible} onClick={checkTranscription}>检查转写资源</button>}
            {transcription && (transcription.ready?<div><p>本地引擎：{transcription.engine}；模型：{transcription.model}。转写会占用本机计算资源。</p>{(!transcriptionStarted || terminal(transcriptionTask) && transcriptionTask?.status!=='completed') && <button className="primary" disabled={busy} onClick={startTranscription}>{transcriptionTask && terminal(transcriptionTask)?'确认并重试转写':'确认并开始或恢复转写'}</button>}</div>:<p>{transcription.reason}<button className="quiet" onClick={onSettings}>前往转写设置</button></p>)}
          </div>)}
          {transcriptionStarted && <div className="task-card"><h2>转写：{transcriptionLabel}</h2>{transcribing && <p>由 SmartSub 在本机处理，耗时取决于视频长度、模型和设备。页面会自动更新；连接暂时中断不会重新提交任务。</p>}{transcriptionTask && !terminal(transcriptionTask) && <button className="secondary" disabled={busy} onClick={cancelTranscription}>取消此转写</button>}{transcriptionTask?.status==='completed' && (transcriptionTask.subtitleCount?Array.from({length:transcriptionTask.subtitleCount},(_,index)=><p key={index}><button className="primary" disabled={busy} onClick={()=>importTranscription(index)}>使用转写字幕 {index+1}</button></p>):<p>转写完成但未找到可用字幕。</p>)}{terminal(transcriptionTask) && transcriptionTask?.status!=='completed' && <button className="secondary" disabled={busy} onClick={checkTranscription}>重新检查转写资源</button>}</div>}
          <details><summary>恢复与任务操作</summary><button className="secondary" disabled={busy} onClick={refreshTask}>查询状态</button>{!task && <button className="secondary" disabled={busy || !url.trim()} onClick={resume}>用原链接恢复提交</button>}{transcriptionStarted && <><button className="secondary" disabled={busy} onClick={refreshTranscription}>查询转写状态</button>{!transcriptionTask && <><button className="secondary" disabled={busy} onClick={checkTranscription}>检查转写资源</button>{transcription?.ready && <button className="secondary" disabled={busy} onClick={startTranscription}>确认并开始或恢复转写</button>}</>}</>}<button className="secondary" disabled={busy} onClick={()=>setForgetting(true)}>放弃跟踪此任务</button></details>
        </section>}
      </section>
      {forgetting && <div className="file-dialog-shade"><section className="file-dialog" role="dialog" aria-modal="true" aria-label="放弃跟踪任务"><h3>放弃跟踪此任务？</h3><p>这只会移除当前界面中的任务记录，不会取消 SmartSub 后台任务。后台任务可能仍在运行，放弃后无法在此界面找回或取消它；请先查询或取消，确认后再继续。</p><footer><button className="secondary" onClick={()=>setForgetting(false)}>继续跟踪</button><button className="primary" onClick={forget}>确认放弃跟踪</button></footer></section></div>}
    </div></main>;
}
