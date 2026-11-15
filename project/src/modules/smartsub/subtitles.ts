import {isAbsolute,relative,resolve,sep} from 'node:path';
import {digest,readBytes} from '../storage/io.ts';
import {MAX_FILE_BYTES,MAX_SEGMENTS,parseSource} from '../source/parser.ts';

/** Read only a task-owned subtitle and verify the CLI's paginated view against its original bytes. */
export async function loadSmartSubSubtitle(cacheRoot:string,path:string,read:(offset:number,limit:number)=>Promise<unknown>) {
  if (!isAbsolute(cacheRoot) || !isAbsolute(path)) throw new Error('字幕路径无效。');
  const file=resolve(path), diff=relative(resolve(cacheRoot),file);
  if (!diff || isAbsolute(diff) || diff==='..' || diff.startsWith('..'+sep)) throw new Error('字幕路径不在任务目录中。');
  const bytes=await readBytes(file,MAX_FILE_BYTES), document=parseSource(bytes,file);
  // Plain-text exports have no cue timeline. Read them through the same bounded,
  // symlink-rejecting source parser used by ordinary TXT imports.
  if(document.format==='txt')return {document,bytes};
  let offset=0, version:unknown, total:number|undefined;
  while (total===undefined || offset<total) {
    const raw=await read(offset,500);
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('字幕回执无效。');
    const page=raw as Record<string,any>;
    if (page.filePath!==file || page.offset!==offset || page.format!==document.format || typeof page.version!=='string' || !page.version || !Number.isInteger(page.total) || page.total<1 || page.total>MAX_SEGMENTS || !Array.isArray(page.cues) || page.cues.length<1 || page.cues.length>500 || offset+page.cues.length>page.total) throw new Error('字幕回执无效。');
    if (total===undefined) {total=page.total;version=page.version;} else if (total!==page.total || version!==page.version) throw new Error('字幕读取期间发生变化。');
    for (const cue of page.cues) {
      const segment=document.segments[offset++];
      if (!cue || typeof cue.text!=='string' || !Number.isSafeInteger(cue.startMs) || !Number.isSafeInteger(cue.endMs) || cue.startMs<0 || cue.endMs<=cue.startMs || !segment || cue.startMs!==segment.startMs || cue.endMs!==segment.endMs) throw new Error('字幕内容不一致。');
    }
  }
  if (total!==document.segments.length || digest(bytes)!==digest(await readBytes(file,MAX_FILE_BYTES))) throw new Error('字幕读取期间发生变化。');
  return {document,bytes};
}
