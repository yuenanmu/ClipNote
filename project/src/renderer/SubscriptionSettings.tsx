import {useEffect, useState} from 'react';

type Session = {status:string; sharing:boolean; identity?:{name?:string;email?:string}; error?:{message:string}};
export function SubscriptionSettings(){
  const [session,setSession]=useState<Session>();
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [models,setModels]=useState<{slug:string;displayName:string}[]>([]);
  const refresh=async()=>{const result=await window.clipnote.subscriptionState();if(result.status!=='ok')throw new Error(result.status==='error'?result.error.message:'操作已取消。');setSession(result.value);};
  useEffect(()=>{void refresh().catch(()=>setMessage('无法读取订阅状态。'));},[]);
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await action();}catch(error){setMessage(error instanceof Error?error.message:'操作未完成。');}finally{setBusy(false);}};
  return <section className="api-settings" aria-label="ChatGPT 订阅"><h1>ChatGPT 订阅</h1><p>使用当前 ChatGPT 账户授权，登录信息加密保存在这台电脑上。</p>
    <p role="status">{session ? session.status==='connected' ? `已连接 ${session.identity?.email ?? session.identity?.name ?? ''}${session.sharing?'':'，订阅共享不可用'}` : session.status==='reauth_required'?'需要重新登录':'尚未连接' : '正在读取连接状态…'}</p>
    <div className="api-actions"><button className="primary" disabled={busy} onClick={()=>void run(async()=>{const result=await window.clipnote.subscriptionSignIn();if(result.status==='error')throw new Error(result.error.message);await refresh();})}>登录 ChatGPT</button>
    {busy && <button className="secondary" onClick={()=>void window.clipnote.subscriptionCancel()}>取消登录</button>}
    <button className="secondary" disabled={busy || session?.status!=='connected'} onClick={()=>void run(async()=>{const result=await window.clipnote.subscriptionModels();if(result.status!=='ok')throw new Error(result.status==='error'?result.error.message:'操作已取消。');setModels(result.value);})}>获取可用模型</button>
    <button className="secondary" disabled={busy || session?.status!=='connected'} onClick={()=>void run(async()=>{const result=await window.clipnote.subscriptionDisconnect();if(result.status==='error')throw new Error(result.error.message);setModels([]);await refresh();})}>退出登录</button></div>
    {(message || session?.error) && <p role="alert">{message || session?.error?.message}</p>}{models.length>0 && <p>可用模型：{models.map(model=>model.displayName).join('、')}</p>}
  </section>;
}
