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
const milestones = {
  headers:'响应头',
  first_text:'首次正文', received:'接收结束', validating:'校验', saving:'写盘',
} as const;

export function OrganizationStatus({id,onStatus,fallback,error,timing}:{id?:string;onStatus?:(status:OrganizationTaskSnapshot['status']|undefined)=>void;fallback?:string;error?:string;timing?:{prepareMs:number;apiMs:number;localMs:number;saveMs:number;requests:number}}) {
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
  const current = snapshot?.id === id ? snapshot : undefined;
  const event = current?.events.at(-1);
  const lastWork = current?.events.slice().reverse().find(item=>!['failed','cancelled','succeeded'].includes(item.phase));
  const chunks = current?.chunkProgress;
  const phase = chunks && chunks.completed === chunks.total && event?.phase === 'validating' ? '正在合并' : event ? labels[event.phase] : fallback;
  if (!phase) return null;
  const reason = current?.error ? reasons[current.error] ?? error ?? '整理未完成' : error;
  const elapsed = current?.elapsedMs ?? (event ? event.elapsedMs + (current?.status === 'running' ? Math.max(0,clock-observed.current.at) : 0) : 0);
  return <div className="organization-status" aria-label="整理阶段">
    <div role="status"><strong>{phase}</strong></div>
    {chunks ? <label className="organization-chunks">已完成 {chunks.completed}/{chunks.total} 块<progress value={chunks.completed} max={chunks.total} /></label>
      : (current?.status === 'running' || (!current && fallback === '正在整理')) && <progress aria-label="整理进行中" />}
    {reason && <p role="alert">{reason}</p>}
    {(event || timing) && <details>
      <summary>详细信息</summary>
      {event && <p>已用 {(elapsed/1000).toFixed(1)} 秒 · {current?.requests ?? 0} 次请求{current?.status === 'failed' && lastWork ? ` · 上一阶段：${labels[lastWork.phase]}` : ''}</p>}
      {current?.status === 'running' && <p>单请求上限 {STREAM_DEADLINE_DEFAULTS.requestMs/1000} 秒，等待首个有效输出 {STREAM_DEADLINE_DEFAULTS.firstOutputMs/1000} 秒，输出停滞 {STREAM_DEADLINE_DEFAULTS.idleMs/1000} 秒。整份资料另有处理上限。</p>}
      {timing && <p>本次耗时：准备 {(timing.prepareMs/1000).toFixed(1)} 秒 · API {(timing.apiMs/1000).toFixed(1)} 秒 · 校验 {(timing.localMs/1000).toFixed(1)} 秒 · 保存 {(timing.saveMs/1000).toFixed(1)} 秒</p>}
      {current && <ul>{current.events.flatMap(({phase, elapsedMs}, index) => {
        const label = milestones[phase as keyof typeof milestones];
        return label ? [<li key={index}>{label} · {(elapsedMs / 1000).toFixed(1)} 秒</li>] : [];
      })}</ul>}
    </details>}
  </div>;
}
