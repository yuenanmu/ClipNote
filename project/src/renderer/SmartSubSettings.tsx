import {useEffect,useState} from 'react';
import type {SmartSubDiscovery,SmartSubReadiness,SmartSubPreferencesView} from '../contracts/smartsub.ts';
import {unwrap} from './workspace-api.ts';

export function SmartSubSettings(){
  const [state,setState]=useState<SmartSubDiscovery>(),[ready,setReady]=useState<SmartSubReadiness>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [resources,setResources]=useState<SmartSubPreferencesView>(),[engine,setEngine]=useState(''),[model,setModel]=useState(''),[saved,setSaved]=useState(false);
  useEffect(()=>{let alive=true;if(ready?.transcriptionCompatible)void window.clipnote.smartsubPreferences().then(result=>{if(!alive)return;const value=unwrap(result);setResources(value);setEngine(value.selection?.engine??'');setModel(value.selection?.model??'');}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'无法读取转写资源。');});return()=>{alive=false;};},[ready]);
  useEffect(()=>{let alive=true;void window.clipnote.smartsubState().then(result=>{if(alive)setState(unwrap(result));}).catch(()=>{if(alive)setError('暂时无法检查安装，请重试。');});return()=>{alive=false;};},[]);
  useEffect(()=>{let alive=true;setReady(undefined);if(state?.installed)void window.clipnote.smartsubReadiness().then(result=>{if(alive)setReady(unwrap(result));}).catch(()=>{if(alive)setError('安装位置已保存，但暂时无法连接 SmartSub。请检查程序权限后重试。');});return()=>{alive=false;};},[state]);
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'操作未完成，请重试。');}finally{setBusy(false);}};
  const engines:Record<string,string>={builtin:'Whisper（内置）',fasterWhisper:'Faster Whisper',funasr:'FunASR',qwen:'Qwen ASR',fireRedAsr:'FireRed ASR',parakeet:'Parakeet'};
  const selected=resources?.options.find(option=>option.id===engine);
  return <div className="smartsub-settings"><section className="settings-card"><h2>连接 SmartSub</h2><p>选择一次安装位置，视频任务会自动使用此配置。</p>
    {state?.installed?<><strong>已找到 SmartSub</strong><p className="installation-path">{state.path}</p></>:state?<><strong>尚未找到 SmartSub</strong><p>如果已经安装，请选择安装文件夹。</p></>:<p>正在检查安装…</p>}
    <div className="smartsub-actions"><button className="secondary" disabled={busy} onClick={()=>void run(async()=>{const result=await window.clipnote.smartsubChoose();if(result.status!=='cancelled')setState(unwrap(result));})}>选择安装文件夹</button><button className="secondary" disabled={busy} onClick={()=>void run(async()=>setState(unwrap(await window.clipnote.smartsubState())))}>重新检测连接</button><button className="quiet" disabled={busy} onClick={()=>void run(async()=>{unwrap(await window.clipnote.smartsubOpenOfficial());})}>打开官方下载页面</button></div>
    {ready && <p>SmartSub {ready.version} · {ready.compatible?'任务接口可用':'任务接口不兼容'} · {ready.downloaders.length?`下载组件：${ready.downloaders.join('、')}`:'缺少下载组件，请在 SmartSub 中安装'}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </section><section className="settings-card"><h2>本地转写</h2><p>先获取已有字幕；没有字幕时，再确认使用本地引擎转写。模型不会自动下载，转写不会自动开始。</p>
    {resources?<>{resources.warning && <p className="notice" role="status">{resources.warning}</p>}<div className="transcription-fields"><label>转写引擎<select value={engine} disabled={busy} onChange={event=>{setEngine(event.target.value);setModel('');setSaved(false);}}><option value="">请选择本地引擎</option>{resources.options.map(option=><option key={option.id} value={option.id} disabled={!option.ready}>{engines[option.id]??option.id}{option.ready?'':'（未就绪）'}</option>)}</select></label><label>转写模型<select value={model} disabled={busy || !selected?.ready} onChange={event=>{setModel(event.target.value);setSaved(false);}}><option value="">请选择已安装的模型</option>{model && !selected?.models.includes(model) && <option value={model} disabled>{model}（不可用）</option>}{selected?.models.map(value=><option value={value} key={value}>{value}</option>)}</select></label></div>
    <p>{resources.selection?`当前保存：${engines[resources.selection.engine]??resources.selection.engine} / ${resources.selection.model}`:'尚未单独设置时，使用 SmartSub 中的本地默认配置。'} 缺少引擎或模型时，请在 SmartSub 中查看用途、大小并确认安装，再重新检测连接。</p>
    <button className="primary" disabled={busy || !selected?.ready || !selected.models.includes(model)} onClick={()=>void run(async()=>{const selection=unwrap(await window.clipnote.smartsubSavePreferences({engine,model}));setResources({...resources,selection,warning:undefined});setSaved(true);})}>保存转写设置</button>{saved && <p role="status">转写设置已保存</p>}
    </>:<p>{ready && !ready.transcriptionCompatible?'当前版本缺少本地转写接口。':state?.installed?'正在检查本地引擎和模型…':'连接 SmartSub 后，可选择已有本地引擎和模型。'}</p>}
    </section></div>;
}
