import { basename } from 'node:path';
import { isUuid } from '../modules/storage/io.ts';
import { ApiError } from '../modules/api/errors.ts';
import { AnalysisError } from '../modules/analysis/errors.ts';
import { WorkspaceError, type OutputPlan } from '../modules/workspace/files.ts';
import type {BatchState,BatchItem,WorkspaceResult} from '../contracts/workspace.ts';

type Config = { baseUrl: string; model: string; instructions?: string };
interface Dependencies {
  isTrustedSender(event: unknown): boolean; config(): Promise<{ baseUrl: string; model: string }>;
  preview(id: string, target: string): Promise<OutputPlan>;
  analyze(id: string, config: Config, signal: AbortSignal, plan: OutputPlan): Promise<{ markdown: string;timing?:BatchItem['timing'] }>;
  save(id: string, target: string, plan: OutputPlan, markdown: string): Promise<void>;
  lock?(plans: OutputPlan[]):()=>void;
  stage?(plan:OutputPlan,markdown:string):Promise<string>;
  complete?(id:string):Promise<void>;
}
export function createBatchHandlers(deps: Dependencies): Record<'state' | 'prepare' | 'start' | 'cancel' | 'retry' | 'saved', (event: unknown, ...args: unknown[]) => Promise<WorkspaceResult<BatchState>>> {
  let state: BatchState = { status: 'idle', items: [] }, target = '', config: Config | undefined, abort: AbortController | undefined, preparing = false;
  let plans = new Map<string, OutputPlan>(), pending = new Map<string, string>();
  const drafts=new Map<string,string>();let release:(()=>void)|undefined;
  const failure = (message: string):WorkspaceResult<BatchState> => ({ status: 'error', error: { code: 'BATCH_ERROR', message } });
  const snapshot = ():WorkspaceResult<BatchState> => ({ status: 'ok', value: structuredClone(state) });
  const safe = (error: unknown) => error instanceof ApiError || error instanceof AnalysisError ? error.message : error instanceof WorkspaceError && error.code === 'CONFLICT' ? '目标文件已存在、已更改或归属不明，请检查后重新确认。' : error instanceof WorkspaceError && ['MISSING','RELINK_REQUIRED','ASSOCIATION_LOST'].includes(error.code) ? '已关联的笔记已移动或关联登记未完成，请重新关联。' : '处理未完成，请检查文件及目录。';
  const run = async (signal: AbortSignal) => {
    for (const item of state.items) {
      if (item.status !== 'queued') continue;
      if (signal.aborted) { item.status = 'cancelled'; continue; }
      item.status = 'running'; item.error = undefined; item.canRetrySave = false;
      let saveStarted:number|undefined;
      try {
        let markdown=pending.get(item.id);if(markdown===undefined){const result=await deps.analyze(item.id,config!,signal,plans.get(item.id)!);markdown=result.markdown;item.timing=result.timing;}
        if (signal.aborted) { item.status = 'cancelled'; continue; }
        pending.set(item.id, markdown);
        saveStarted=performance.now();
        if(deps.stage && !drafts.has(item.id)) drafts.set(item.id,await deps.stage(plans.get(item.id)!,markdown));
        if(signal.aborted){item.status='cancelled';continue;}
        await deps.save(item.id, target, plans.get(item.id)!, markdown);
        const draft=drafts.get(item.id);if(draft && deps.complete)await deps.complete(draft);drafts.delete(item.id);pending.delete(item.id); item.status = 'succeeded';
      } catch (error) { item.status = signal.aborted ? 'cancelled' : 'failed'; if (!signal.aborted) { item.error = safe(error); item.canRetrySave = pending.has(item.id); } }
      finally{if(item.timing && saveStarted!==undefined)item.timing.saveMs+=performance.now()-saveStarted;}
    }
    release?.();release=undefined;state.status = signal.aborted ? 'cancelled' : 'done'; abort = undefined;
  };
  const handle = (action: 'state' | 'prepare' | 'start' | 'cancel' | 'retry' | 'saved') => async (event: unknown, ...args: unknown[]) => {
    if (!deps.isTrustedSender(event)) return failure('无法执行批量整理。');
    if(action==='saved'){if(args.length!==2 || !isUuid(args[0]) || typeof args[1]!=='string')return failure('保存状态无效。');for(const item of state.items)if(drafts.get(item.id)===args[0]){drafts.delete(item.id);pending.delete(item.id);item.status='succeeded';item.outputPath=args[1];item.error=undefined;item.canRetrySave=false;}return snapshot();}
    if (action === 'state') return args.length ? failure('无法执行批量整理。') : snapshot();
    if (action === 'cancel') { if (args.length) return failure('无法执行批量整理。'); abort?.abort(); return snapshot(); }
    if (state.status === 'running' || preparing) return failure('已有批量任务正在进行。');
    if (action === 'prepare') {
      const [ids, folder, selected] = args as [unknown, unknown, any];
      if (args.length !== 3 || !Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => !isUuid(id)) || new Set(ids).size !== ids.length || !isUuid(folder) || !selected || Object.keys(selected).sort().join(',') !== 'baseUrl,instructions,model' || typeof selected.baseUrl !== 'string' || typeof selected.model !== 'string' || typeof selected.instructions !== 'string' || selected.instructions.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(selected.instructions)) return failure('批量选择或整理要求无效。');
      preparing = true;
      try {
        const current = await deps.config(); if (current.baseUrl !== selected.baseUrl || current.model !== selected.model) return failure('服务配置已改变，请重新确认。');
        const next = new Map<string, OutputPlan>(), names = new Set<string>();
        for (const id of ids) { const plan = await deps.preview(id, folder); const key = plan.notePath.toLowerCase(); if (names.has(key)) return failure('所选资料存在同名输出，请先重命名。'); names.add(key); next.set(id, plan); }
        target = folder; config = { baseUrl: selected.baseUrl, model: selected.model, instructions: selected.instructions }; plans = next; pending = new Map();
        drafts.clear();state = { status: 'ready', baseUrl: config.baseUrl, model: config.model, items: ids.map(id => ({ id, name: basename(next.get(id)!.sourcePath), outputName: next.get(id)!.name, outputPath:next.get(id)!.notePath, overwrite: next.get(id)!.exists, status: 'queued' })) }; return snapshot();
      } catch (error) { return failure(safe(error)); } finally { preparing = false; }
    }
    if (action === 'start') {
      if (args.length || state.status !== 'ready' || !config) return failure('请先准备并确认批量任务。');
      preparing = true; try { const current = await deps.config(); if (current.baseUrl !== config.baseUrl || current.model !== config.model) return failure('服务配置已改变，请重新确认。');
        for (const item of state.items) { const expected = plans.get(item.id)!, actual = await deps.preview(item.id, target); if (actual.sourcePath !== expected.sourcePath || actual.notePath !== expected.notePath || actual.exists !== expected.exists || actual.checksum !== expected.checksum || actual.sourceChecksum!==expected.sourceChecksum) return failure('文件或目标已更改，请重新检查并确认。'); }
        release=deps.lock?.([...plans.values()]);abort = new AbortController(); state.status = 'running'; void run(abort.signal); return snapshot();
      } catch (error) { return failure(safe(error)); } finally { preparing = false; }
    }
    if (action === 'retry') {
      const ids = args[0]; if (args.length !== 1 || !Array.isArray(ids) || !ids.length || ids.some(id => !state.items.some(item => item.id === id && item.status === 'failed'))) return failure('请选择失败项目。');
      preparing = true; try { if(ids.some(id=>!pending.has(id))){ const current = await deps.config(); if (!config || current.baseUrl !== config.baseUrl || current.model !== config.model) return failure('服务配置已改变，请重新确认。'); }
        release=deps.lock?.(ids.map(id=>plans.get(id)!));for (const item of state.items) if (ids.includes(item.id)) item.status = 'queued'; abort = new AbortController(); state.status = 'running'; void run(abort.signal); return snapshot();
      } catch { return failure('无法读取服务配置。'); } finally { preparing = false; }
    }
    return failure('无法执行批量整理。');
  };
  return { state: handle('state'), prepare: handle('prepare'), start: handle('start'), cancel: handle('cancel'), retry: handle('retry'),saved:handle('saved') };
}
