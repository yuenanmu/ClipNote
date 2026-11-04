import {exists,readJson,writeAtomic} from '../storage/io.ts';
import {modelKeys,inspectTranscription,type TranscriptionSelection} from './transcription.ts';
type Invoke=(operation:string,input:unknown)=>Promise<unknown>;
export class SmartSubPreferences {
  private path:string;private invoke:Invoke;
  constructor(path:string,invoke:Invoke){this.path=path;this.invoke=invoke;}
  async selection():Promise<TranscriptionSelection|undefined>{
    if(!await exists(this.path))return undefined;
    const saved=await readJson(this.path);
    if(saved.version!==1 || Object.keys(saved).sort().join(',')!=='engine,model,version' || !validSelection(saved))throw new Error('转写设置不可用，请重新保存。');
    return {engine:saved.engine,model:saved.model};
  }
  async state(){
    let selection:TranscriptionSelection|undefined,warning:string|undefined;
    try{selection=await this.selection();}catch{warning='已保存的转写设置不可用，请重新选择并保存。';}
    const engines=await this.invoke('engines.list',{}),models=await this.invoke('models.list',{});
    if(!engines || typeof engines!=='object' || Array.isArray(engines) || !models || typeof models!=='object' || Array.isArray(models))throw new Error('无法读取本地转写资源。');
    const options=Object.entries(modelKeys).map(([id,key])=>({id,ready:(engines as any)[id]?.state==='ready',models:Array.isArray((models as any)[key])?Array.from(new Set<string>((models as any)[key].filter((v:unknown)=>typeof v==='string' && v.length>0 && v.length<200 && !/[\x00-\x1f]/.test(v)))).slice(0,500):[]}));
    return {selection:selection??null,options,...(warning?{warning}:{})};
  }
  async save(selection:unknown){
    if(!validSelection(selection) || Object.keys(selection).sort().join(',')!=='engine,model')throw new Error('转写设置参数无效。');
    const ready=await inspectTranscription(this.invoke,selection);if(!ready.ready)throw new Error(ready.reason);
    await writeAtomic(this.path,{version:1,engine:selection.engine,model:selection.model});
    return {engine:selection.engine,model:selection.model};
  }
}
function validSelection(value:unknown):value is TranscriptionSelection{return Boolean(value && typeof value==='object' && !Array.isArray(value) && typeof (value as any).engine==='string' && Object.hasOwn(modelKeys,(value as any).engine) && typeof (value as any).model==='string' && (value as any).model.length>0 && (value as any).model.length<200 && !/[\x00-\x1f]/.test((value as any).model));}
