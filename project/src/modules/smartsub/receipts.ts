import {extname,isAbsolute,relative,resolve,sep} from 'node:path';
import {makeTaskRequest} from './requests.ts';

const states=['queued','running','paused','review','cancelling','completed','failed','cancelled','interrupted'] as const;
export type SmartSubTaskStatus=typeof states[number];
export function parseTaskReceipt(value:unknown,id:string,cacheRoot:string,transcription=false):{id:string;status:SmartSubTaskStatus;subtitlePaths:string[];mediaPaths:string[];hasSubtitles:boolean}{
  makeTaskRequest(id);if(!isAbsolute(cacheRoot))throw new Error('任务目录无效。');
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('任务回执无效。');
  // Transcription receipts may include upstream temporary side artifacts. Never import them.
  // Downloads retain strict rejection; transcription imports only task-owned exports.
  const task=value as Record<string,any>;
  if(task.id!==id || !states.includes(task.status))throw new Error('任务回执无效。');
  const subtitlePaths:string[]=[],mediaPaths:string[]=[],seen=new Set<string>(),root=resolve(cacheRoot);let hasSubtitles=false;
  const add=(raw:unknown,kind:'subtitle'|'media')=>{
    if(typeof raw!=='string' || !isAbsolute(raw) || raw.includes('\0'))throw new Error('字幕路径无效。');
    const path=resolve(raw),diff=relative(root,path);
    if(!diff || isAbsolute(diff) || diff==='..' || diff.startsWith('..'+sep)){if(transcription)return;throw new Error('字幕路径不在任务目录中。');}
    if(kind==='subtitle')hasSubtitles=true;
    const ext=extname(path).toLowerCase();if(kind==='subtitle'?!(transcription?['.srt','.vtt','.txt']:['.srt','.vtt']).includes(ext):!['.mp4','.mkv','.webm','.mov','.m4a','.mp3','.wav','.aac','.flac'].includes(ext))return;
    const key=process.platform==='win32'?path.toLowerCase():path;if(!seen.has(key)){seen.add(key);(kind==='subtitle'?subtitlePaths:mediaPaths).push(path);}
  };
  if(task.status==='completed'){
    const artifacts=[...(Array.isArray(task.artifacts)?task.artifacts:[]),...(Array.isArray(task.result?.artifacts)?task.result.artifacts:[])];
    if(artifacts.length>1000)throw new Error('任务回执过大。');
    for(const artifact of artifacts)if(artifact && typeof artifact==='object'){const kind=String(artifact.kind).toLowerCase();if(['subtitle','srt','vtt','ass','ssa','lrc',...(transcription?['txt']:[])].includes(kind))add(artifact.path,'subtitle');else if(['video','mp4','mkv','webm','mov','m4a','mp3','wav','aac','flac'].includes(kind))add(artifact.path,'media');}
    const entries=task.result?.downloadEntries;if(entries!==undefined && !Array.isArray(entries))throw new Error('任务回执无效。');
    if(entries?.length>1000)throw new Error('任务回执过大。');
    for(const entry of entries??[]){if(entry?.subtitlePaths!==undefined && !Array.isArray(entry.subtitlePaths))throw new Error('任务回执无效。');if(entry?.subtitlePaths?.length>1000)throw new Error('任务回执过大。');for(const path of entry?.subtitlePaths??[])add(path,'subtitle');}
  }
  return {id,status:task.status,subtitlePaths,mediaPaths,hasSubtitles};
}
