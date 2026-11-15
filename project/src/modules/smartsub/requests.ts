import {isAbsolute} from 'node:path';
import {isUuid} from '../storage/io.ts';

/** Build only the explicitly confirmed, subtitle-first download request. */
export function makeDownloadRequest(url:string,cachePath:string,requestId:string){
  if(typeof url!=='string' || !url || url.length>4096 || /[\x00-\x20\x7f]/.test(url))throw new Error('链接无效。');
  let parsed:URL;try{parsed=new URL(url);}catch{throw new Error('链接无效。');}
  if(!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password)throw new Error('链接无效。');
  if(typeof cachePath!=='string' || !isAbsolute(cachePath) || cachePath.includes('\0') || !isUuid(requestId))throw new Error('任务参数无效。');
  return {requestId,config:{name:'ClipNote',savePath:cachePath,quality:'best',engine:'auto',writeSubs:true,entries:[{url}]}};
}
export function makeTaskRequest(id:string){
  if(typeof id!=='string' || !id.trim() || id.length>256 || /[\x00-\x1f\x7f]/.test(id))throw new Error('任务标识无效。');
  return {id};
}
export function makeWaitRequest(id:string,timeoutMs:number){
  if(!Number.isSafeInteger(timeoutMs) || timeoutMs<0 || timeoutMs>25000)throw new Error('等待时间无效。');
  return {...makeTaskRequest(id),timeoutMs};
}
export function makeSubtitleReadRequest(filePath:string,offset:number,limit:number){
  if(typeof filePath!=='string' || !isAbsolute(filePath) || filePath.includes('\0') || !Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1 || limit>500)throw new Error('字幕读取参数无效。');
  return {filePath,offset,limit};
}
