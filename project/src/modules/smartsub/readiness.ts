type Invoke=(operation:string,input:unknown)=>Promise<unknown>;
export async function inspectSmartSub(invoke:Invoke){
  const info=await invoke('system.info',{}), capabilities=await invoke('system.capabilities',{}), engines=await invoke('downloads.engines',{fetchRemote:false});
  if(!info || typeof info!=='object' || Array.isArray(info) || typeof (info as any).version!=='string' || !Array.isArray(capabilities) || !Array.isArray(engines))throw new Error('SmartSub 返回的准备信息无效。');
  const names=new Set(capabilities.map(value=>value?.name));
  const compatible=(info as any).apiVersion===1 && ['downloads.start','tasks.get','tasks.cancel','subtitles.read'].every(name=>names.has(name));
  const transcriptionCompatible=compatible && ['transcribe','settings.get','engines.list','models.list'].every(name=>names.has(name));
  const downloaders=engines.filter(value=>value && ['yt-dlp','lux'].includes(value.engine) && value.installed && typeof value.installed==='object').map(value=>value.engine as string);
  return {version:(info as any).version as string,compatible,transcriptionCompatible,downloaders};
}
