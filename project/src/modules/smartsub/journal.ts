import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {digest,isUuid,readJson,writeAtomic} from '../storage/io.ts';
import {makeDownloadRequest,makeTaskRequest} from './requests.ts';

const states=['prepared','queued','running','paused','review','cancelling','completed','failed','cancelled','interrupted'] as const;
type State=typeof states[number];
export interface SmartSubRecord {version:1;requestId:string;inputHash:string;status:State;taskId?:string}
/** Durable identity only: private links and subtitle text are never persisted here. */
export class SmartSubJournal {
  private readonly directory:string;
  private queue:Promise<unknown>=Promise.resolve();
  constructor(directory:string){this.directory=resolve(directory);}
  private path(id:string){if(!isUuid(id))throw new Error('任务标识无效。');return join(this.directory,id+'.json');}
  private serial<T>(action:()=>Promise<T>):Promise<T>{const next=this.queue.then(action,action);this.queue=next.catch(()=>{});return next;}
  async prepare(url:string,cachePath:string):Promise<SmartSubRecord>{
    const requestId=randomUUID(),input=makeDownloadRequest(url,cachePath,requestId);
    const value:SmartSubRecord={version:1,requestId,inputHash:digest(JSON.stringify(input.config)),status:'prepared'};
    await writeAtomic(this.path(requestId),value);return value;
  }
  async reopen(id:string):Promise<SmartSubRecord>{
    const value=await readJson(this.path(id));
    if(value.version!==1 || value.requestId!==id || typeof value.inputHash!=='string' || !/^[a-f0-9]{64}$/.test(value.inputHash) || !states.includes(value.status) || Object.keys(value).some(key=>!['version','requestId','inputHash','status','taskId'].includes(key)))throw new Error('任务记录损坏。');
    if(value.taskId!==undefined)makeTaskRequest(value.taskId);
    if(value.status!=='prepared' && value.taskId===undefined)throw new Error('任务记录损坏。');
    return value as SmartSubRecord;
  }
  async request(id:string,url:string,cachePath:string){
    const record=await this.reopen(id),input=makeDownloadRequest(url,cachePath,id);
    if(digest(JSON.stringify(input.config))!==record.inputHash)throw new Error('链接或保存位置已改变，不能复用原任务。');
    return input;
  }
  submitted(id:string,taskId:string):Promise<SmartSubRecord>{return this.serial(async()=>{
    makeTaskRequest(taskId);const record=await this.reopen(id);
    if(record.taskId && record.taskId!==taskId)throw new Error('任务标识不一致。');
    if(!record.taskId){record.taskId=taskId;record.status='queued';await writeAtomic(this.path(id),record);}return record;
  });}
  observe(id:string,status:string):Promise<SmartSubRecord>{return this.serial(async()=>{
    if(!states.includes(status as State) || status==='prepared')throw new Error('任务状态无效。');
    const record=await this.reopen(id);if(!record.taskId)throw new Error('任务尚未登记。');
    if(['completed','failed','cancelled','interrupted'].includes(record.status) && record.status!==status)throw new Error('终态任务不能更改状态。');
    record.status=status as State;await writeAtomic(this.path(id),record);return record;
  });}
}
