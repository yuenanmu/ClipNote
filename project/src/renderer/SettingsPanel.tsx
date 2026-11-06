import {useState} from 'react';
import {ApiSettings} from './features/api/ApiSettings.tsx';
import {SubscriptionSettings} from './SubscriptionSettings.tsx';
import {SmartSubSettings} from './SmartSubSettings.tsx';
import './smartsub.css';

export function SettingsPanel({initialTab,onBack}:{initialTab:'api'|'smartsub';onBack():void}){
  const [tab,setTab]=useState<'api'|'smartsub'|'subscription'>(initialTab);
  return <section className="settings-view" aria-label="应用设置">
    <header className="toolbar"><div><p className="eyebrow">工作台 / 设置</p><h1>设置</h1><p className="toolbar-caption">配置保存在本机，下次使用时自动读取。</p></div><button className="secondary" onClick={onBack}>返回文件工作台</button></header>
    <div className="settings-tabs" role="tablist" aria-label="设置分类"><button role="tab" aria-selected={tab==='api'} aria-controls="api-settings-panel" id="api-settings-tab" onClick={()=>setTab('api')}>AI 服务</button><button role="tab" aria-selected={tab==='subscription'} aria-controls="subscription-settings-panel" id="subscription-settings-tab" onClick={()=>setTab('subscription')}>ChatGPT 订阅</button><button role="tab" aria-selected={tab==='smartsub'} aria-controls="smartsub-settings-panel" id="smartsub-settings-tab" onClick={()=>setTab('smartsub')}>SmartSub</button></div>
    <div role="tabpanel" id="api-settings-panel" aria-labelledby="api-settings-tab" hidden={tab!=='api'}><ApiSettings embedded onBack={onBack}/></div>
    {tab==='subscription' && <div role="tabpanel" id="subscription-settings-panel" aria-labelledby="subscription-settings-tab"><SubscriptionSettings/></div>}
    {tab==='smartsub' && <div role="tabpanel" id="smartsub-settings-panel" aria-labelledby="smartsub-settings-tab"><SmartSubSettings/></div>}
  </section>;
}
