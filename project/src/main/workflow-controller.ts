import type { SourceSnapshot } from '../contracts/source.ts';
import type { ApiConfigInput } from '../contracts/api.ts';
import type { AnalysisOptions, AnalysisResult } from '../contracts/analysis.ts';
import type { SavedRevision } from '../contracts/storage.ts';
import type { WorkflowResult, WorkflowState } from '../contracts/workflow.ts';
import { isSourceId } from '../modules/storage/io.ts';
import { StorageError } from '../modules/storage/errors.ts';
import { AnalysisError } from '../modules/analysis/errors.ts';
import { ApiError } from '../modules/api/errors.ts';
interface Dependencies {
  isTrustedSender(event: unknown): boolean; source(id: string): SourceSnapshot | undefined;
  credentials(): Promise<ApiConfigInput>; hasDirectory(): Promise<boolean>;
  analyze(source: SourceSnapshot['document'], credentials: ApiConfigInput, options: AnalysisOptions): Promise<AnalysisResult>;
  save(snapshot: SourceSnapshot, result: AnalysisResult): Promise<SavedRevision>; resume(id: string): Promise<SavedRevision>;
}
export function createWorkflowHandlers(deps: Dependencies): Record<'state' | 'start' | 'cancel' | 'retry', (event: unknown, ...args: unknown[]) => Promise<WorkflowResult>> {
  let state: WorkflowState = { status: 'idle', completedChunks: 0 }; let abort: AbortController | undefined;
  let pending: { snapshot: SourceSnapshot; result: AnalysisResult; draftId?: string } | undefined;
  const snapshot = () => structuredClone(state);
  const errorResult = (code: string, message: string): WorkflowResult => ({ status: 'error', error: { code, message } });
  const safe = (error: unknown) => error instanceof StorageError || error instanceof AnalysisError || error instanceof ApiError ? { code: error.code, message: error.message } : { code: 'WORKFLOW_FAILED', message: '分析或保存未完成，请重试。' };
  const publish = async () => {
    state = { ...state, status: 'saving', error: undefined, canRetrySave: false };
    try { const revision = pending!.draftId ? await deps.resume(pending!.draftId) : await deps.save(pending!.snapshot, pending!.result); pending = undefined; state = { ...state, status: 'succeeded', revision }; }
    catch (error) { if (error instanceof StorageError && error.draftId) pending!.draftId = error.draftId; state = { ...state, status: 'failed', error: safe(error), canRetrySave: true }; }
  };
  const run = async (source: SourceSnapshot, signal: AbortSignal, expected: { baseUrl: string; model: string }) => {
    try {
      if (!await deps.hasDirectory()) throw new StorageError('DIRECTORY_REQUIRED');
      const credentials = await deps.credentials(); if (signal.aborted) throw new AnalysisError('CANCELLED');
      if (credentials.baseUrl !== expected.baseUrl || credentials.model !== expected.model) { state = { ...state, status: 'failed', error: { code: 'CONFIG_CHANGED', message: '服务配置已改变，请重新确认发送对象。' } }; return; }
      const result = await deps.analyze(source.document, credentials, { signal, onCheckpoint: () => { state = { ...state, completedChunks: state.completedChunks + 1 }; } });
      if (signal.aborted) throw new AnalysisError('CANCELLED'); pending = { snapshot: source, result }; await publish();
    } catch (error) { state = { ...state, status: signal.aborted ? 'cancelled' : 'failed', error: signal.aborted ? undefined : safe(error) }; }
    finally { abort = undefined; }
  };
  const handler = (action: 'state' | 'start' | 'cancel' | 'retry') => async (event: unknown, ...args: unknown[]): Promise<WorkflowResult> => {
    const expected = args[1] as Record<string, unknown> | undefined;
    if (!deps.isTrustedSender(event) || (action === 'start' ? args.length !== 2 || !isSourceId(args[0]) || !expected || typeof expected !== 'object' || Object.keys(expected).sort().join(',') !== 'baseUrl,model' || typeof expected.baseUrl !== 'string' || typeof expected.model !== 'string' || expected.baseUrl.length > 2048 || expected.model.length > 128 : args.length !== 0)) return errorResult('INVALID_REQUEST', '无法执行此分析请求。');
    if (action === 'state') return { status: 'ok', value: snapshot() };
    if (action === 'cancel') { if (state.status === 'running') abort?.abort(); return { status: 'ok', value: snapshot() }; }
    if (['running', 'saving'].includes(state.status)) return errorResult('BUSY', '已有分析或保存正在进行。');
    if (action === 'retry') { if (!pending) return errorResult('INVALID_REQUEST', '没有待重试的保存结果。'); void publish(); return { status: 'ok', value: snapshot() }; }
    if (pending) return errorResult('SAVE_PENDING', '请先重试保存已完成的结果。');
    const source = deps.source(args[0] as string); if (!source) return errorResult('INVALID_REQUEST', '来源已过期，请重新导入。');
    abort = new AbortController(); state = { status: 'running', completedChunks: 0, sourceId: source.document.sourceId }; void run(source, abort.signal, expected as { baseUrl: string; model: string });
    return { status: 'ok', value: snapshot() };
  };
  return { state: handler('state'), start: handler('start'), cancel: handler('cancel'), retry: handler('retry') };
}
