import {randomUUID} from 'node:crypto';
import {exists,isUuid,readJson,writeAtomic} from '../storage/io.ts';
import {TranscriptionResourceError} from './transcription-tasks.ts';
import {makeDownloadRequest} from './requests.ts';
import type {SmartSubTaskView,SmartSubTranscriptionReadiness,SmartSubSelection,VideoQueueView,VideoStage} from '../../contracts/smartsub.ts';

type Lane='download'|'transcription';
type Active='downloading'|'transcribing';
interface Item {
  id:string;
  requestId:string;
  link:string;
  host:string;
  stage:VideoStage;
  autoTranscribe:boolean;
  selection?:SmartSubSelection;
  attemptId?:string;
  retryTranscription?:boolean;
  lane?:Lane;
  confirmed?:boolean;
  cancelRequested?:boolean;
  remoteCancelling?:boolean;
  message?:string;
  subtitleCount?:number;
}
interface Dependencies {
  encrypt(link:string):Promise<string>;
  decrypt(link:string):Promise<string>;
  prepare(id:string,url:string):Promise<void>;
  download(id:string,url:string):Promise<SmartSubTaskView>;
  downloadStatus(id:string):Promise<SmartSubTaskView>;
  cancelDownload(id:string):Promise<SmartSubTaskView>;
  selection():Promise<SmartSubSelection|undefined>;
  transcriptionReady(id:string):Promise<SmartSubTranscriptionReadiness>;
  transcribe(id:string,selection:SmartSubSelection,attemptId:string,retry:boolean):Promise<SmartSubTaskView>;
  transcriptionStatus(id:string,attemptId:string):Promise<SmartSubTaskView>;
  cancelTranscription(id:string):Promise<SmartSubTaskView>;
}
const stages:VideoStage[]=['queued','downloading','waiting-transcription','transcribing','blocked','ready','failed','cancelled'];
const isFinished=(stage:VideoStage)=>stage==='ready' || stage==='failed' || stage==='cancelled';
const activeStage=(lane:Lane):Active=>lane==='download'?'downloading':'transcribing';
const waitingStage=(lane:Lane):VideoStage=>lane==='download'?'queued':'waiting-transcription';
const validSelection=(value:unknown):value is SmartSubSelection=>!!value && typeof value==='object' &&
  'engine' in value && typeof value.engine==='string' && !!value.engine && value.engine.length<100 &&
  'model' in value && typeof value.model==='string' && !!value.model && value.model.length<200;
const MAX_ITEMS=200;

export class VideoQueue {
  private readonly initial:Promise<void>;
  private items:Item[]=[];
  private paused=false;
  private writes:Promise<unknown>=Promise.resolve();
  private readonly running=new Set<Lane>();
  private readonly retryAfter=new Map<string,number>();
  private readonly cancelling=new Set<string>();
  private readonly issue=new Map<string,string>();
  private readonly resubmit=new Set<string>();
  private readonly labels=new Map<string,string>();
  private timer?:ReturnType<typeof setInterval>;
  private stopped=false;

  private readonly path:string;
  private readonly deps:Dependencies;
  constructor(path:string,deps:Dependencies) {
    this.path=path;this.deps=deps;
    this.initial=this.load();
    void this.initial.catch(()=>{});
  }
  private async load() {
    if (!await exists(this.path)) return;
    const raw=await readJson(this.path);
    if (raw.version!==1 || !Array.isArray(raw.items) || raw.items.length>MAX_ITEMS || raw.items.some(row=>
      !row || !isUuid(row.id) || !isUuid(row.requestId) || typeof row.link!=='string' || !row.link || row.link.length>30000 ||
      typeof row.host!=='string' || !stages.includes(row.stage) || typeof row.autoTranscribe!=='boolean' ||
      (row.lane!==undefined && row.lane!=='download' && row.lane!=='transcription') ||
      (row.selection!==undefined && !validSelection(row.selection)) ||
      (row.stage==='transcribing' && (!isUuid(row.attemptId) || !row.selection)) ||
      (row.stage==='ready' && (row.lane===undefined || !Number.isSafeInteger(row.subtitleCount) || row.subtitleCount<1)) ||
      (row.message!==undefined && (typeof row.message!=='string' || row.message.length>240))
    )) throw new Error('视频队列记录损坏，请保留原文件。');
    if (new Set(raw.items.map(row=>row.id)).size!==raw.items.length ||
        ['downloading','transcribing'].some(stage=>raw.items.filter((row:Item)=>row.stage===stage).length>1))
      throw new Error('视频队列记录损坏，请保留原文件。');
    this.items=raw.items;
    this.paused=this.items.some(row=>!isFinished(row.stage));
    // URLs remain encrypted on disk. Only the logged-in desktop sees labels.
    await Promise.all(this.items.map(async row=>{
      try {this.labels.set(row.id,await this.deps.decrypt(row.link));} catch {}
    }));
  }
  private change(transform:(items:Item[])=>Item[]):Promise<void> {
    const write=this.writes.then(async()=>{
      await this.initial;
      const next=transform(this.items);
      if (next===this.items) return;
      await writeAtomic(this.path,{version:1,items:next});
      this.items=next;
    });
    this.writes=write.catch(()=>{});
    return write;
  }
  private patch(id:string, update:(item:Item)=>Item):Promise<void> {
    return this.change(items=>{
      const current=items.find(row=>row.id===id);
      if(!current)return items;
      const next=update(current);
      return next===current?items:items.map(row=>row===current?next:row);
    });
  }
  async state():Promise<VideoQueueView> {
    await this.initial;
    return {paused:this.paused && this.items.some(row=>!isFinished(row.stage)),items:this.items.map(row=>({
      id:row.id,label:this.labels.get(row.id)??row.host,stage:row.stage,
      subtitleCount:row.subtitleCount??0,message:this.issue.get(row.id)??row.message,cancelRequested:row.cancelRequested,
      needsRecovery:!row.confirmed&&this.issue.has(row.id)&&(row.stage==='downloading'||row.stage==='transcribing'),
    }))};
  }
  async occupiesSlots():Promise<boolean> {
    await this.initial;
    return this.items.some(row=>row.stage==='downloading' || row.stage==='transcribing' ||
      (!this.paused && (row.stage==='queued' || row.stage==='waiting-transcription')));
  }
  start() {
    if(this.timer)return;
    this.stopped=false;
    this.timer=setInterval(()=>this.wake(),1500);
    this.timer.unref();
    this.wake();
  }
  stop() { this.stopped=true;clearInterval(this.timer);this.timer=undefined; }
  private wake() { if(this.timer && !this.stopped) void this.tick().catch(()=>{}); }

  async add(text:string,autoTranscribe:boolean) {
    await this.initial;
    if(typeof text!=='string' || text.length>100000 || typeof autoTranscribe!=='boolean') throw new Error('视频链接输入无效。');
    const links=[...new Set(text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean))];
    if(!links.length || links.length>100) throw new Error('每次添加 1 到 100 条视频链接，每行一条。');
    const validated=links.map((link,index)=>{
      const requestId=randomUUID();
      try {makeDownloadRequest(link,process.cwd(),requestId);} catch {throw new Error('第 '+(index+1)+' 条链接无效，请填写完整的 HTTP 或 HTTPS 地址。');}
      return {link,requestId,host:new URL(link).hostname};
    });
    const selection=autoTranscribe?await this.deps.selection():undefined;
    const rows=await Promise.all(validated.map(async value=>{
      const id=randomUUID();
      return {id,requestId:value.requestId,host:value.host,link:await this.deps.encrypt(value.link),stage:'queued' as const,autoTranscribe,selection};
    }));
    await this.change(items=>{
      const fresh=rows.filter((_,index)=>!items.some(item=>!isFinished(item.stage) && this.labels.get(item.id)===links[index]));
      if(items.length+fresh.length>MAX_ITEMS) throw new Error('队列已满，请移除一些已结束的任务。');
      fresh.forEach(row=>this.labels.set(row.id,links[rows.indexOf(row)]));
      return [...items,...fresh];
    });
    this.wake();
  }
  async resume() { await this.initial;this.paused=false;this.wake(); }
  async refresh(id:string) {
    await this.initial;
    if(!this.items.some(row=>row.id===id && (row.stage==='downloading' || row.stage==='transcribing'))) throw new Error('当前任务无需查询。');
    this.retryAfter.delete(id);
    this.resubmit.add(id);
    this.wake();
  }
  async cancel(id:string) {
    await this.patch(id,item=>{
      if(isFinished(item.stage)) return item;
      if(item.stage==='downloading'||item.stage==='transcribing') return {...item,cancelRequested:true};
      return {...item,stage:'cancelled',message:undefined};
    });
    this.retryAfter.delete(id);
    const row=this.items.find(item=>item.id===id);
    if(this.timer && row?.confirmed && row.cancelRequested && (row.stage==='downloading'||row.stage==='transcribing'))
      void this.sendCancel(row,row.stage==='downloading'?'download':'transcription').catch(()=>this.queryFailed(row.id));
    this.wake();
  }
  async retry(id:string) {
    await this.initial;
    const previous=this.items.find(row=>row.id===id);
    if(!previous || !['blocked','failed'].includes(previous.stage)) throw new Error('当前任务无法重试。');
    const selection=previous.lane==='transcription'?await this.deps.selection():previous.selection;
    await this.patch(id,item=>{
      if(item!==previous) return item;
      this.issue.delete(id);
      if(item.lane==='transcription') return {...item,stage:'waiting-transcription',selection,autoTranscribe:true,remoteCancelling:false,
        retryTranscription:!!item.retryTranscription||!!item.attemptId,attemptId:undefined,confirmed:false,message:undefined};
      return {...item,stage:'queued',requestId:randomUUID(),confirmed:false,remoteCancelling:false,message:undefined};
    });
    this.wake();
  }
  async remove(id:string) {
    await this.change(items=>items.filter(row=>row.id!==id || !isFinished(row.stage)));
    if(!this.items.some(row=>row.id===id)){this.labels.delete(id);this.issue.delete(id);this.resubmit.delete(id);this.retryAfter.delete(id);}
  }
  async subtitle(id:string,index:number) {
    await this.initial;
    const row=this.items.find(item=>item.id===id);
    if(row?.stage!=='ready'||!row.lane||!Number.isSafeInteger(index)||index<0||index>=(row.subtitleCount??0)) throw new Error('字幕尚不可用。');
    return {lane:row.lane, requestId:row.requestId};
  }
  async tick() { await this.initial; await Promise.all([this.step('download'),this.step('transcription')]); }
  private async step(lane:Lane) {
    if(this.stopped || this.running.has(lane)) return;
    const current=this.items.find(row=>row.stage===activeStage(lane));
    const next=this.paused?undefined:this.items.find(row=>row.stage===waitingStage(lane));
    const row=current??next;
    if(!row || (this.retryAfter.get(row.id)??0)>Date.now()) return;
    this.running.add(lane);
    try {
      if(current) await this.observe(current,lane);
      else if(lane==='download') await this.beginDownload(row);
      else await this.beginTranscription(row);
    } catch(error) {
      if (error instanceof TranscriptionResourceError) {
        await this.patch(row.id,item=>item.stage==='transcribing'?{...item,stage:'blocked',message:error.message,attemptId:undefined}:item);
      } else this.queryFailed(row.id);
    } finally {this.running.delete(lane);}
  }
  private async claim(row:Item,patch:Partial<Item>) {
    let claimed:Item|undefined;
    await this.patch(row.id,item=>item===row && !this.paused ? (claimed={...item,...patch}) : item);
    return claimed;
  }
  private async beginDownload(row:Item) {
    let url:string;
    try {
      url=await this.deps.decrypt(row.link);
      await this.deps.prepare(row.requestId,url);
    } catch {
      await this.claim(row,{stage:'failed',lane:'download',message:'无法准备下载，请检查链接、SmartSub 连接和本地存储。'});
      return;
    }
    const item=await this.claim(row,{stage:'downloading',lane:'download',confirmed:false});
    if(item && !this.stopped) await this.accept(item,'download',await this.deps.download(item.requestId,url));
  }
  private async beginTranscription(row:Item) {
    const ready=await this.deps.transcriptionReady(row.requestId).catch(()=>undefined);
    if(!ready?.ready || (row.selection && (row.selection.engine!==ready.engine || row.selection.model!==ready.model))) {
      await this.claim(row,{stage:'blocked',lane:'transcription',message:ready && !ready.ready?ready.reason:'请检查模型设置并确认转写。'});
      return;
    }
    const selection={engine:ready.engine,model:ready.model};
    const item=await this.claim(row,{stage:'transcribing',lane:'transcription',selection,attemptId:randomUUID(),confirmed:false});
    if(item && !this.stopped) await this.accept(item,'transcription',await this.deps.transcribe(item.requestId,selection,item.attemptId!,!!item.retryTranscription));
  }
  private queryFailed(id:string) {
    this.issue.set(id,'暂时无法确认任务状态，请重新查询原任务。');
    this.retryAfter.set(id,Date.now()+5000);
  }
  private async sendCancel(row:Item,lane:Lane) {
    if(this.cancelling.has(row.id))return;
    this.cancelling.add(row.id);
    try {
      const value=await (lane==='download'?this.deps.cancelDownload(row.requestId):this.deps.cancelTranscription(row.requestId));
      await this.accept(row,lane,value);
    } finally { this.cancelling.delete(row.id); }
  }
  private async observe(row:Item,lane:Lane) {
    if(row.cancelRequested && row.confirmed && !row.remoteCancelling) return this.sendCancel(row,lane);
    const retry=this.resubmit.delete(row.id);
    let value:SmartSubTaskView;
    try {
      value=await (lane==='download'?this.deps.downloadStatus(row.requestId):this.deps.transcriptionStatus(row.requestId,row.attemptId!));
    } catch(error) {
      if (!retry||row.confirmed||this.stopped) throw error;
      value=lane==='download'
        ? await this.deps.download(row.requestId,await this.deps.decrypt(row.link))
        : await this.deps.transcribe(row.requestId,row.selection!,row.attemptId!,!!row.retryTranscription);
    }
    if(row.cancelRequested && !['completed','failed','cancelled','interrupted','cancelling'].includes(value.status))
      value=await (lane==='download'?this.deps.cancelDownload(row.requestId):this.deps.cancelTranscription(row.requestId));
    await this.accept(row,lane,value);
  }
  private async accept(row:Item,lane:Lane,value:SmartSubTaskView) {
    if(value.requestId!==row.requestId) throw new Error('任务回执无效。');
    this.issue.delete(row.id);this.retryAfter.delete(row.id);
    await this.patch(row.id,item=>{
      if(item.stage!==activeStage(lane) || item.requestId!==row.requestId || item.attemptId!==row.attemptId) return item;
      if(value.status==='cancelled') return {...item,stage:'cancelled',cancelRequested:false};
      if(value.status==='failed'||value.status==='interrupted') return {...item,stage:'failed',cancelRequested:false,
        message:lane==='download'?'获取字幕或下载失败。':'本机转写失败。'};
      if(value.status!=='completed') {
        const remoteCancelling=item.remoteCancelling || value.status==='cancelling';
        const message=value.status==='paused'?'SmartSub 已暂停此任务。':value.status==='review'?'等待在 SmartSub 中处理。':undefined;
        return item.confirmed && item.remoteCancelling===remoteCancelling && item.message===message
          ? item : {...item,confirmed:true,remoteCancelling,message};
      }
      if(value.subtitleCount>0) return {...item,stage:'ready',subtitleCount:value.subtitleCount,cancelRequested:false};
      if(item.cancelRequested) return {...item,stage:'cancelled',cancelRequested:false};
      if(lane==='download' && !value.hasSubtitles) return item.autoTranscribe
        ? {...item,stage:'waiting-transcription',lane:'transcription'}
        : {...item,stage:'blocked',lane:'transcription',message:'未找到字幕，确认后可用本机模型转写。'};
      return {...item,stage:'failed',message:value.hasSubtitles?'现有字幕格式暂不支持。':'转写结束，未找到可用字幕。'};
    });
  }
}
