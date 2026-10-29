type Invoke=(operation:string,input:unknown)=>Promise<unknown>;
export type TranscriptionReadiness={ready:true;engine:string;model:string}|{ready:false;reason:string};
export async function inspectTranscription(invoke:Invoke):Promise<TranscriptionReadiness>{
  const settings=await invoke('settings.get',{});
  if(!settings || typeof settings!=='object' || Array.isArray(settings))throw new Error('无法读取转写配置。');
  const defaults=(settings as any).defaults;
  if(!defaults || typeof defaults!=='object')return {ready:false,reason:'请先在 SmartSub 中配置本地转写引擎和模型。'};
  const engine=defaults.transcriptionEngine || 'builtin', model=defaults.model;
  const keys:Record<string,string>={builtin:'modelsInstalled',fasterWhisper:'fasterWhisperModelsInstalled',funasr:'funasrAsrModelsInstalled',qwen:'qwenModelsInstalled',fireRedAsr:'fireRedModelsInstalled',parakeet:'parakeetModelsInstalled'};
  if(!Object.hasOwn(keys,engine))return {ready:false,reason:'请在 SmartSub 中选择本地转写引擎；云端转写尚未接入。'};
  if(typeof model!=='string' || !model || model.length>200)return {ready:false,reason:'请先在 SmartSub 中选择本地转写模型。'};
  const engines=await invoke('engines.list',{}),models=await invoke('models.list',{});
  if(!engines || typeof engines!=='object' || !models || typeof models!=='object')throw new Error('无法读取转写资源状态。');
  if((engines as any)[engine]?.state!=='ready')return {ready:false,reason:'本地转写引擎未就绪，请在 SmartSub 中检查所需组件。'};
  if(!Array.isArray((models as any)[keys[engine]]) || !(models as any)[keys[engine]].includes(model))return {ready:false,reason:'所选转写模型尚未安装，请在 SmartSub 中确认并安装。'};
  return {ready:true,engine,model};
}
