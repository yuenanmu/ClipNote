import {randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {checkedDirectory,isUuid} from '../storage/io.ts';
import {SmartSubJournal} from './journal.ts';
import {makeTaskRequest,makeSubtitleReadRequest} from './requests.ts';
import {parseTaskReceipt} from './receipts.ts';
import {loadSmartSubSubtitle} from './subtitles.ts';

type Invoke=(operation:string,input:unknown,binding?:string)=>Promise<unknown>;
export class SmartSubTasks {
  private journal:SmartSubJournal;
  private root:string;
  private invoke:Invoke;
  private identity?:()=>Promise<string>;
  constructor(root:string,invoke:Invoke,identity?:()=>Promise<string>){this.invoke=invoke;this.identity=identity;this.root=resolve(root);this.journal=new SmartSubJournal(join(this.root,'journal'));}
  private cache(id:string){if(!isUuid(id))throw new Error('任务标识无效。');return join(this.root,'downloads',id);}
  cacheDirectory(id:string){return this.cache(id);}
  downloadReceipt(id:string){return this.operation(id,'tasks.get');}
  async prepare(url:string){const id=randomUUID(),cache=this.cache(id),binding=this.identity?await this.identity():undefined;await checkedDirectory(cache,true);return this.journal.prepare(url,cache,id,binding);}
  async invokeFor(id:string,operation:string,input:unknown){const record=await this.journal.reopen(id);if(this.identity && (!record.binding || record.binding!==await this.identity()))throw new Error('SmartSub 安装或后台身份已变化，请切回原安装后恢复。');return this.invoke(operation,input,record.binding);}
  async submit(id:string,url:string){
    const record=await this.journal.reopen(id),request=await this.journal.request(id,url,this.cache(id));if(record.taskId)return this.refresh(id);
    const raw=await this.invokeFor(id,'downloads.start',request);
    if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new Error('任务回执无效。');
    const taskId=(raw as Record<string,unknown>).id;makeTaskRequest(taskId as string);
    const receipt=parseTaskReceipt(raw,taskId as string,this.cache(id));
    await this.journal.submitted(id,receipt.id);await this.journal.observe(id,receipt.status);
    return {requestId:id,status:receipt.status,subtitleCount:receipt.subtitlePaths.length,hasSubtitles:receipt.hasSubtitles};
  }
  async start(url:string){const record=await this.prepare(url);return this.submit(record.requestId,url);}
  private async operation(id:string,op:'tasks.get'|'tasks.cancel'){
    const record=await this.journal.reopen(id);if(!record.taskId)throw new Error('任务尚未提交，请使用原链接重试。');
    const raw=await this.invokeFor(id,op,makeTaskRequest(record.taskId));
    const receipt=parseTaskReceipt(raw,record.taskId,this.cache(id));await this.journal.observe(id,receipt.status);
    return receipt;
  }
  async refresh(id:string){const receipt=await this.operation(id,'tasks.get');return {requestId:id,status:receipt.status,subtitleCount:receipt.subtitlePaths.length,hasSubtitles:receipt.hasSubtitles};}
  async cancel(id:string){const receipt=await this.operation(id,'tasks.cancel');return {requestId:id,status:receipt.status,subtitleCount:receipt.subtitlePaths.length,hasSubtitles:receipt.hasSubtitles};}
  async subtitle(id:string,index:number){
    if(!Number.isSafeInteger(index) || index<0 || index>999)throw new Error('字幕选择无效。');
    const receipt=await this.operation(id,'tasks.get');if(receipt.status!=='completed' || !receipt.subtitlePaths[index])throw new Error('字幕尚不可用。');
    const path=receipt.subtitlePaths[index];return loadSmartSubSubtitle(this.cache(id),path,(offset,limit)=>this.invokeFor(id,'subtitles.read',makeSubtitleReadRequest(path,offset,limit)));
  }
}
