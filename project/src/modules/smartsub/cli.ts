import {stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';

export interface SmartSubInstallation {root:string;appPath:string;cliPath:string}
/** Discover only a complete installation; callers control the candidate roots. */
export async function findSmartSub(roots: string[]): Promise<SmartSubInstallation|undefined> {
  for(const candidate of roots){
    if(typeof candidate!=='string' || !candidate.trim() || candidate.includes('\0'))continue;
    const root=resolve(candidate),appPath=join(root,'SmartSub.exe'),cliPath=join(root,'resources','automation','cli.cjs');
    try {const [app,cli]=await Promise.all([stat(appPath),stat(cliPath)]);if(app.isFile() && cli.isFile())return {root,appPath,cliPath};} catch { /* Missing or inaccessible candidates do not imply an installation. */ }
  }
  return undefined;
}
const operations=new Set(['system.info','system.capabilities','downloads.engines','engines.list','models.list','downloads.start','tasks.get','tasks.wait','tasks.cancel','subtitles.read']);
export async function invokeSmartSub(install:SmartSubInstallation,operation:string,input:unknown,options:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<unknown>{
  if(!operations.has(operation))throw new Error('不支持的 SmartSub 操作。');
  if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('SmartSub 输入无效。');
  let json:string;try{json=JSON.stringify(input);}catch{throw new Error('SmartSub 输入无效。');}
  if(!json || Buffer.byteLength(json,'utf8')>65536)throw new Error('SmartSub 输入无效。');
  if(options.signal?.aborted)throw new Error('SmartSub 操作已取消。');
  const timeoutMs=options.timeoutMs??30000;if(!Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>120000)throw new Error('SmartSub 超时设置无效。');
  return new Promise((resolveResult,reject)=>{
    const args=[install.cliPath,...operation.split('.'),'--input-json','-','--json'];
    const child=spawn(install.appPath,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',SMARTSUB_APP_PATH:install.appPath}});
    let done=false,size=0;const chunks:Buffer[]=[];
    const finish=(error?:Error,value?:unknown)=>{if(done)return;done=true;clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);if(error){child.kill();reject(error);}else resolveResult(value);};
    const cancel=()=>finish(new Error('SmartSub 操作已取消。'));
    const timer=setTimeout(()=>finish(new Error('SmartSub 操作超时；后台任务可能仍在运行，请重新查询。')),timeoutMs);
    options.signal?.addEventListener('abort',cancel,{once:true});
    child.on('error',()=>finish(new Error('SmartSub CLI 启动失败。')));
    child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
    child.stdout.on('data',(data:Buffer)=>{size+=data.length;if(size>1024*1024){finish(new Error('SmartSub 返回结果超过上限。'));return;}chunks.push(data);});
    child.on('close',code=>{if(done)return;if(code!==0){finish(new Error(code===5?'SmartSub 操作超时；后台任务可能仍在运行，请重新查询。':code===130?'SmartSub 操作已取消。':'SmartSub 操作失败，请检查程序状态。'));return;}try{finish(undefined,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(new Error('SmartSub 返回结果无效。'));}});
    child.stdin.end(json);
    if(options.signal?.aborted)cancel();
  });
}
