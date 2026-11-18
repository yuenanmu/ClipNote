import {useEffect, useRef, useState} from 'react';
import type {OrganizationTaskSnapshot, DiagnosticEvent} from '../contracts/organization-task.ts';
import {STREAM_DEADLINE_DEFAULTS} from '../modules/analysis/stream-deadline.ts';

const labels:Record<DiagnosticEvent['phase'],string> = {
  preparing:'准备资料', request:'等待首个有效输出', headers:'等待首个有效输出',
  first_text:'正在接收正文', last_text:'正在接收正文', received:'接收完成',
  validating:'校验内容', staging:'准备保存', awaiting_save:'等待确认保存',
  saving:'保存笔记', saved:'已保存', succeeded:'已完成', failed:'失败', cancelled:'已取消',
};
const reasons:Record<string,string> = {
  first_output_timeout:'等待首个有效输出超时', stream_idle_timeout:'正文接收停滞超时',
  request_timeout:'单次请求达到时间上限', file_timeout:'整份资料达到时间上限',
  timeout:'服务响应超时', network:'连接中断或服务不可用', saving:'保存失败',
  authentication:'账户认证失败', permission:'账户没有访问权限', rate_limit:'服务限流或额度不足',
  validation:'内容校验失败', invalid_response:'服务响应无效', unknown:'整理未完成',
};

export function OrganizationStatus({id,onStatus}:{id?:string;onStatus?:(status:OrganizationTaskSnapshot['status']|undefined)=>void}) {
  const [snapshot,setSnapshot]=useState<OrganizationTaskSnapshot>();
  const [clock,setClock]=useState(0);
  const observed=useRef({revision:-1,event:'',at:0});
  useEffect(()=>{
    let alive=true;
    setSnapshot(undefined);
    onStatus?.(undefined);
    observed.current={revision:-1,event:'',at:performance.now()};
    if(!id)return;
    const refresh=async()=>{
      try {
        const result=await window.clipnote.organizationGet(id);
        if(alive && result.status==='ok' && result.value?.id===id && result.value.revision>=observed.current.revision){
          const last=result.value.events.at(-1);
          const key=last ? `${last.phase}:${last.elapsedMs}` : '';
          observed.current={revision:result.value.revision,event:key,at:key===observed.current.event?observed.current.at:performance.now()};
          setSnapshot(result.value);
          onStatus?.(result.value.status);
          setClock(performance.now());
        }
      } catch { if(alive)setSnapshot(undefined); }
    };
    void refresh();
    const timer=setInterval(()=>void refresh(),500);
    return ()=>{alive=false;clearInterval(timer);};
  },[id,onStatus]);
  if(!snapshot || snapshot.id!==id)return null;
  const event=snapshot.events.at(-1);
  const lastWork=[...snapshot.events].reverse().find(item=>!['failed','cancelled','succeeded'].includes(item.phase));
  if(!event)return null;
  return <div aria-label="整理阶段">
    <p>{labels[event.phase]}{snapshot.status==='failed' && lastWork ? ` · 上一阶段：${labels[lastWork.phase]}` : ''} · 已用 {((event.elapsedMs+(snapshot.status==='running'?Math.max(0,clock-observed.current.at):0))/1000).toFixed(1)} 秒</p>
    {snapshot.status==='running' && <small>单次请求最多 {STREAM_DEADLINE_DEFAULTS.requestMs/1000} 秒，首个有效输出等待上限 {STREAM_DEADLINE_DEFAULTS.firstOutputMs/1000} 秒，输出停滞上限 {STREAM_DEADLINE_DEFAULTS.idleMs/1000} 秒。整份资料另有处理上限。</small>}
    {snapshot.error && <p>{reasons[snapshot.error] ?? '整理未完成'}</p>}
  </div>;
}
