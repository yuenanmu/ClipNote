const terminal=new Set(['completed','failed','cancelled','interrupted']);
type Schedule=(work:()=>void,delay:number)=>()=>void;
/** One outstanding query at a time; an observation error never changes the task's state. */
export function observeSmartSubTask<T extends {status:string}>(query:()=>Promise<T>,receive:(value:T)=>void,failed:(error:Error)=>void,options:{schedule?:Schedule}={}){
  let stopped=false,running=false,failures=0,cancelTimer:(()=>void)|undefined;
  const schedule=options.schedule??((work,delay)=>{const timer=setTimeout(work,delay);return ()=>clearTimeout(timer);});
  const poll=async()=>{
    if(stopped || running)return;running=true;cancelTimer=undefined;
    try{const value=await query();if(stopped)return;failures=0;receive(value);if(terminal.has(value.status)){stopped=true;return;}}
    catch(error){if(stopped)return;failures++;failed(error instanceof Error?error:new Error('无法获取任务状态。'));}
    finally{running=false;}
    if(!stopped)cancelTimer=schedule(()=>void poll(),Math.min(15000,1500*2**Math.min(failures,4)));
  };
  void poll();return Object.assign(()=>{stopped=true;cancelTimer?.();},{refresh:()=>{if(stopped || running)return;cancelTimer?.();cancelTimer=undefined;void poll();}});
}
