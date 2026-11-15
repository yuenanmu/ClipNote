import type { SourceDocument } from '../../contracts/source.ts';
import type { ApiConfigInput } from '../../contracts/api.ts';
import type { ChunkCheckpoint } from '../../contracts/analysis.ts';
import { createHash } from 'node:crypto';
// One serial batch only. The caller re-reads and validates each source before lookup.
export class BatchReuse {
  private entries = new Map<string,string>();
  private bytes = 0;
  private partial=new Map<string,{value:ChunkCheckpoint[];bytes:number}>();
  clear() { this.entries.clear();this.partial.clear();this.bytes=0; }
  async run(source: SourceDocument, config: ApiConfigInput, instructions: string, signal: AbortSignal, generate: (checkpoints:ChunkCheckpoint[]) => Promise<string>) {
    signal.throwIfAborted();
    const key=createHash('sha256').update(JSON.stringify([source.checksum,source.format,config.baseUrl,config.model,config.contextWindow,config.maxTokens,config.apiKey,instructions,'t15-ranges-v3'])).digest('hex');
    const previous=this.entries.get(key);
    if(previous!==undefined)return {markdown:previous,reused:true};
    const earlier=this.partial.get(key);
    let markdown:string;
    try {markdown=await generate(structuredClone(earlier?.value??[]));signal.throwIfAborted();}
    catch(error){
      const value=(error as {checkpoints?:ChunkCheckpoint[]})?.checkpoints;
      if(Array.isArray(value) && value.length){
        const bytes=Buffer.byteLength(JSON.stringify(value),'utf8');
        if(this.partial.size<100 && this.bytes-(earlier?.bytes??0)+bytes<=16*1024*1024){this.partial.set(key,{value:structuredClone(value),bytes});this.bytes+=bytes-(earlier?.bytes??0);}
      }
      throw error;
    }
    if(earlier){this.partial.delete(key);this.bytes-=earlier.bytes;}
    const size=Buffer.byteLength(markdown,'utf8');
    if(this.entries.size<100 && this.bytes+size<=16*1024*1024){this.entries.set(key,markdown);this.bytes+=size;}
    return { markdown, reused: false };
  }
}
