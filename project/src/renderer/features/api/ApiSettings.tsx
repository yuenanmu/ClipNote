import { useEffect, useState } from 'react';
import type { ApiProfileView, ApiProfilesView } from '../../../contracts/api.ts';
import { unwrap } from '../../workspace-api.ts';
import './api.css';

const emptyForm = {name:'API 服务',baseUrl:'',model:'',apiKey:'',contextWindow:104857,maxTokens:10480};
const profileRef = ({id,revision}:ApiProfileView) => ({id,revision});

export function ApiSettings({onBack,embedded=false}:{onBack():void;embedded?:boolean}) {
  const [services,setServices]=useState<ApiProfilesView>({profiles:[]});
  const [selected,setSelected]=useState<ApiProfileView>();
  const [form,setForm]=useState(emptyForm);
  const [busy,setBusy]=useState(true),[activity,setActivity]=useState<'test'|'models'>();
  const [models,setModels]=useState<string[]>([]);
  const [notice,setNotice]=useState<{text:string;error?:boolean}>();
  const [deleting,setDeleting]=useState(false),[keyCleared,setKeyCleared]=useState(false);
  const select=(profile?:ApiProfileView)=>{
    setSelected(profile);
    setForm(profile ? {...profile,apiKey:''} : emptyForm);
    setModels([]);setNotice(undefined);setKeyCleared(false);setDeleting(false);
  };
  useEffect(()=>{
    let alive=true;
    void window.clipnote.apiProfiles().then(unwrap).then(value=>{
      if(!alive)return;
      setServices(value);select(value.profiles.find(profile=>profile.id===value.defaultId)??value.profiles[0]);
    }).catch(error=>{if(alive)setNotice({text:error.message,error:true});})
      .finally(()=>{if(alive)setBusy(false);});
    return()=>{alive=false;};
  },[]);
  const run=async(work:()=>Promise<void>)=>{
    if(busy)return;
    setBusy(true);setNotice(undefined);
    try{await work();}catch(error){setNotice({text:error instanceof Error?error.message:'API 操作未完成。',error:true});}
    finally{setBusy(false);setActivity(undefined);}
  };
  const reload=async()=>{const value=unwrap(await window.clipnote.apiProfiles());setServices(value);return value;};
  const changeBase=(baseUrl:string)=>{
    if(form.apiKey)setKeyCleared(true);
    setForm({...form,baseUrl,apiKey:''});setModels([]);
  };
  const changed=!selected || form.name!==selected.name || form.baseUrl.replace(/\/$/,'')!==selected.baseUrl ||
    form.model!==selected.model || form.contextWindow!==selected.contextWindow || form.maxTokens!==selected.maxTokens || !!form.apiKey;
  const save=()=>void run(async()=>{
    const {name,baseUrl,model,apiKey,contextWindow,maxTokens}=form;
    const input={name,baseUrl,model,apiKey,contextWindow,maxTokens};
    const profile=unwrap(await window.clipnote.apiSaveProfile(selected ? {...input,...profileRef(selected)} : input));
    await reload();select(profile);setNotice({text:'设置已安全保存'});
  });
  const fetchModels=()=>void run(async()=>{
    setActivity('models');setModels([]);
    const value=unwrap(await window.clipnote.apiModels({baseUrl:form.baseUrl,apiKey:form.apiKey,profile:selected?profileRef(selected):null}));
    setModels(value);setNotice({text:value.length?'请选择模型，或手动填写模型名称。':'服务未返回模型，请手动填写。'});
  });
  const testConnection=()=>void run(async()=>{
    if(!selected)return;
    setActivity('test');unwrap(await window.clipnote.apiTest(profileRef(selected)));
    setNotice({text:'连接测试通过'});
  });
  const setDefault=()=>void run(async()=>{
    if(!selected)return;
    unwrap(await window.clipnote.apiSetDefault(selected.id));await reload();setNotice({text:'已设为默认服务。'});
  });
  const remove=()=>void run(async()=>{
    if(!selected)return;
    unwrap(await window.clipnote.apiDeleteProfile(profileRef(selected)));
    const value=await reload();select(value.profiles.find(profile=>profile.id===value.defaultId)??value.profiles[0]);
    setNotice({text:'已删除 API 服务。'});
  });
  return <div className={embedded?'api-embedded':'api-shell'}>
    {!embedded && <header className="toolbar"><h1>AI 服务</h1><button className="secondary" onClick={onBack}>返回文件工作台</button></header>}
    <main className="api-panel">
      <section className="api-profile-list" aria-label="API 服务列表">
        <header><h2>API 服务</h2><button className="secondary" disabled={busy} onClick={()=>select()}>添加服务</button></header>
        {services.profiles.map(profile=><button key={profile.id} className="api-profile-card" aria-pressed={profile.id===selected?.id} disabled={busy} onClick={()=>select(profile)}>
          <strong>{profile.name}</strong>{profile.id===services.defaultId && <small>默认</small>}<span>{profile.model}</span>
        </button>)}
      </section>
      <section className="api-form">
        <h2>{selected?selected.name:'添加 API 服务'}</h2>
        <label>服务名称<input value={form.name} maxLength={80} disabled={busy} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label>服务地址<input aria-label="服务地址" value={form.baseUrl} placeholder="https://服务地址/v1" disabled={busy} onChange={e=>changeBase(e.target.value)}/></label>
        {/^https:\/\/platform\.deepseek\.com\/?$/i.test(form.baseUrl.trim()) && <button className="secondary" onClick={()=>changeBase('https://api.deepseek.com')}>使用 API 地址</button>}
        <label>模型名称<input aria-label="模型名称" value={form.model} disabled={busy} onChange={e=>setForm({...form,model:e.target.value})}/></label>
        <label>API 密钥<input aria-label="API 密钥" type="password" autoComplete="off" value={form.apiKey} placeholder={selected?'留空以保留已有密钥':'填写此服务的密钥'} disabled={busy} onChange={e=>{setForm({...form,apiKey:e.target.value});setKeyCleared(false);}}/></label>
        {keyCleared && <p>服务地址已改变，请填写该地址的密钥。</p>}
        <div className="api-model-picker"><button className="secondary" disabled={busy || !form.baseUrl.trim() || (!selected && !form.apiKey.trim())} onClick={fetchModels}>获取模型列表</button>
          {models.length>0 && <label>选择模型<select aria-label="选择模型" value={models.includes(form.model)?form.model:''} disabled={busy} onChange={e=>setForm({...form,model:e.target.value})}><option value="">请选择模型</option>{models.map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
        </div>
        <div className="api-budgets">
          <label>上下文窗口（token）<input type="number" min={4096} max={1000000} value={form.contextWindow} disabled={busy} onChange={e=>setForm({...form,contextWindow:Number(e.target.value)})}/></label>
          <label>最大输出（token）<input type="number" min={64} max={32768} value={form.maxTokens} disabled={busy} onChange={e=>setForm({...form,maxTokens:Number(e.target.value)})}/></label>
        </div>
        <div className="api-actions">
          <button className="primary" onClick={save} disabled={busy}>保存设置</button>
          <button className="secondary" onClick={testConnection} disabled={busy || changed}>测试连接</button>
          {selected && selected.id!==services.defaultId && <button className="secondary" onClick={setDefault} disabled={busy}>设为默认</button>}
          {selected && <button className="quiet danger" onClick={()=>setDeleting(true)} disabled={busy}>删除服务</button>}
          {activity && <button className="secondary" onClick={()=>void window.clipnote.apiCancel()}>{activity==='models'?'取消获取':'取消测试'}</button>}
        </div>
        {selected && <p className="api-receiver">测试连接将向 <strong>{selected.baseUrl}</strong> 的 <strong>{selected.model}</strong> 发送固定短文本，可能产生费用。</p>}
        {notice && <div className={`notice ${notice.error?'error':''}`} role={notice.error?'alert':'status'}>{notice.text}</div>}
        {deleting && <div className="file-dialog-shade"><section className="file-dialog" role="dialog" aria-modal="true" aria-label="删除 API 服务">
          <h3>删除「{selected?.name}」？</h3><footer><button className="secondary" onClick={()=>setDeleting(false)}>取消</button><button className="primary danger" disabled={busy} onClick={remove}>确认删除</button></footer>
        </section></div>}
      </section>
    </main>
  </div>;
}
