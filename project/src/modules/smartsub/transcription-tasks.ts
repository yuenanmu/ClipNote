import {randomUUID} from 'node:crypto';
import {lstat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {checkedDirectory,digest,exists,isUuid,readJson,writeAtomic} from '../storage/io.ts';
import {inspectTranscription,type TranscriptionSelection} from './transcription.ts';
import {makeTaskRequest,makeSubtitleReadRequest} from './requests.ts';
import {parseTaskReceipt,type SmartSubTaskStatus} from './receipts.ts';
import {loadSmartSubSubtitle} from './subtitles.ts';

type Invoke=(operation:string,input:unknown)=>Promise<unknown>;
type Receipt=ReturnType<typeof parseTaskReceipt>;
type RecordData={version:1;requestId:string;fingerprint:string;taskId?:string;status:'prepared'|SmartSubTaskStatus};
export class TranscriptionTasks {
  private root:string;private invoke:Invoke;private source:(id:string)=>Promise<Receipt>;private cache:(id:string)=>string;
  private bound?:(id:string,operation:string,input:unknown)=>Promise<unknown>;
  private selection?:()=>Promise<TranscriptionSelection|undefined>;
  private queue:Promise<unknown>=Promise.resolve();
  private writes:Promise<unknown>=Promise.resolve();
  constructor(root:string,invoke:Invoke,source:(id:string)=>Promise<Receipt>,cache?:(id:string)=>string,bound?:(id:string,operation:string,input:unknown)=>Promise<unknown>,selection?:()=>Promise<TranscriptionSelection|undefined>){this.selection=selection;this.root=resolve(root);this.invoke=invoke;this.source=source;this.cache=cache??(()=>this.root);this.bound=bound;}
  private call(id:string,operation:string,input:unknown){return this.bound?this.bound(id,operation,input):this.invoke(operation,input);}
  private serial<T>(work:()=>Promise<T>):Promise<T>{const value=this.queue.then(work,work);this.queue=value.catch(()=>{});return value;}
  private commit<T>(work:()=>Promise<T>):Promise<T>{const value=this.writes.then(work,work);this.writes=value.catch(()=>{});return value;}
  private path(id:string){if(!isUuid(id))throw new Error('任务标识无效。');return join(this.root,'transcriptions',id+'.json');}
  private async record(id:string):Promise<RecordData>{const raw=await readJson(this.path(id));if(raw.version!==1 || !isUuid(raw.requestId) || typeof raw.fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(raw.fingerprint) || !['prepared','queued','running','paused','review','cancelling','completed','failed','cancelled','interrupted'].includes(raw.status) || Object.keys(raw).some(key=>!['version','requestId','fingerprint','taskId','status'].includes(key)))throw new Error('转写任务记录损坏。');if(raw.taskId!==undefined)makeTaskRequest(raw.taskId);if(raw.status!=='prepared' && !raw.taskId)throw new Error('转写任务记录损坏。');return raw as RecordData;}
  async preview(id:string){const receipt=await this.source(id);if(receipt.status!=='completed' || receipt.hasSubtitles || receipt.mediaPaths.length!==1)return {ready:false as const,reason:'只有任务没有字幕且包含单个可用媒体时才能转写。'};const path=receipt.mediaPaths[0];await checkedDirectory(dirname(path));const stat=await lstat(path);if(!stat.isFile() || stat.isSymbolicLink())throw new Error('媒体文件不可用。');return inspectTranscription((op,input)=>this.call(id,op,input),await this.selection?.());}
  submit(id:string,engine:string,model:string){return this.serial(()=>this.submitNow(id,engine,model,false));}
  retry(id:string,engine:string,model:string){return this.serial(()=>this.submitNow(id,engine,model,true));}
  private async submitNow(id:string,engine:string,model:string,retry:boolean){
    const ready=await this.preview(id);if(!ready.ready || ready.engine!==engine || ready.model!==model)throw new Error('转写资源已变化，请重新检查并确认。');
    const source=await this.source(id);if(source.status!=='completed' || source.hasSubtitles || source.mediaPaths.length!==1)throw new Error('原视频任务状态已变化。');
    const path=this.path(id);let existing=await exists(path)?await this.record(id):undefined;
    if(retry){if(!existing?.taskId)throw new Error('原转写尚未确认提交，请先恢复。');const current=await this.query(id,existing,'tasks.get');if(!['failed','cancelled','interrupted'].includes(current.status))throw new Error('原转写尚未失败、取消或中断，不能重试。');await writeAtomic(join(this.root,'transcriptions','history',existing.requestId+'.json'),existing);existing=undefined;}
    const requestId=existing?.requestId??randomUUID();
    const input={files:[source.mediaPaths[0]],engine,model,outputDir:join(this.cache(id),'transcript',requestId),requestId};
    const fingerprint=digest(JSON.stringify(input));if(existing && existing.fingerprint!==fingerprint)throw new Error('转写配置已变化，不能复用原任务。');
    const record:RecordData=existing??{version:1,requestId,fingerprint,status:'prepared'};if(!existing)await writeAtomic(path,record);
    if(record.taskId)return this.query(id,record,'tasks.get');
    const raw=await this.call(id,'transcribe',input);if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new Error('转写回执无效。');
    const taskId=(raw as any).id;makeTaskRequest(taskId);const receipt=parseTaskReceipt(raw,taskId,this.cache(id),true);record.taskId=taskId;record.status=receipt.status;await writeAtomic(path,record);return this.view(id,receipt);
  }
  private view(id:string,receipt:Receipt){return {requestId:id,status:receipt.status,subtitleCount:receipt.subtitlePaths.length,hasSubtitles:receipt.hasSubtitles};}
  private async query(id:string,record:RecordData,op:'tasks.get'|'tasks.cancel'){
    if(!record.taskId)throw new Error('转写尚未提交，请重新确认资源后恢复。');
    const receipt=parseTaskReceipt(await this.call(id,op,makeTaskRequest(record.taskId)),record.taskId,this.cache(id),true);
    return this.commit(async()=>{
      const current=await this.record(id);
      if(current.requestId!==record.requestId || current.taskId!==record.taskId)throw new Error('转写任务已更新，请重新查询。');
      const terminal=['completed','failed','cancelled','interrupted'];
      if((terminal.includes(current.status) || current.status==='cancelling') && !terminal.includes(receipt.status))return {requestId:id,status:current.status as SmartSubTaskStatus,subtitleCount:0,hasSubtitles:false};
      if(terminal.includes(current.status) && current.status!==receipt.status)throw new Error('转写终态不一致。');
      current.status=receipt.status;await writeAtomic(this.path(id),current);return this.view(id,receipt);
    });
  }
  async refresh(id:string){return this.query(id,await this.record(id),'tasks.get');}
  async cancel(id:string){return this.query(id,await this.record(id),'tasks.cancel');}
  async subtitle(id:string,index:number){if(!Number.isSafeInteger(index) || index<0 || index>999)throw new Error('字幕选择无效。');const record=await this.record(id);if(!record.taskId)throw new Error('转写尚未完成。');const receipt=parseTaskReceipt(await this.call(id,'tasks.get',makeTaskRequest(record.taskId)),record.taskId,this.cache(id),true);if(receipt.status!=='completed' || !receipt.subtitlePaths[index])throw new Error('字幕尚不可用。');const path=receipt.subtitlePaths[index];return loadSmartSubSubtitle(this.cache(id),path,(offset,limit)=>this.call(id,'subtitles.read',makeSubtitleReadRequest(path,offset,limit)));}
}
