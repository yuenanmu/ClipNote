import type { AnalysisAdapter, SourceRef } from '../../contracts/analysis.ts';
import type { ApiConfigInput } from '../../contracts/api.ts';
import { ApiError } from './errors.ts';
import type { SourceDocument } from '../../contracts/source.ts';
import type { AnalysisOptions, AnalysisResult } from '../../contracts/analysis.ts';
import { createHash } from 'node:crypto';
import { analyzeSource } from '../analysis/run.ts';
import { planAnalysis } from '../analysis/plan.ts';
import { AnalysisError } from '../analysis/errors.ts';
export async function analyzeWithApi(source: SourceDocument, credentials: ApiConfigInput, options: AnalysisOptions = {}): Promise<AnalysisResult> {
  const inputCharBudget = Math.max(1000, Math.min(16000, Math.floor((credentials.contextWindow - credentials.maxTokens - 512) / 3)));
  const profile = { provider: `api:${createHash('sha256').update(credentials.baseUrl).digest('hex')}`, model: credentials.model, promptVersion: 't15-ranges-v3', inputCharBudget, outputCharBudget: 64000, overlapChars: 0, inputByteBudget: Math.min(512000, credentials.contextWindow - credentials.maxTokens - 612), ...(options.instructions ? { instructions: options.instructions } : {}) };
  const chunks=planAnalysis(source,profile).chunks.length;
  const maxRequests=options.maxRequests??Math.max(8,chunks*4);
  const deadlineMs=options.deadlineMs??Math.min(1800000,Math.max(180000,chunks*90000));
  const deadline=new AbortController(), deadlineTimer=setTimeout(()=>deadline.abort(),deadlineMs);
  const signal=options.signal?AbortSignal.any([options.signal,deadline.signal]):deadline.signal;
  let currentChunk=0;let currentPhase: 'waiting'|'receiving'|'validating'='waiting';
  const report=()=>options.onProgress?.({phase:currentPhase,requests,chunkIndex:currentChunk,totalChunks:chunks,maxRequests,deadlineMs});
  const adapter = createApiAdapter(credentials,60000,()=>{currentPhase='receiving';report();}); let failure: ApiError | undefined; const started = performance.now(); let prepareMs = 0, apiMs = 0, requests = 0;
  try { return await analyzeSource(source, profile, async request => { if(requests>=maxRequests){failure=new ApiError('REQUEST_LIMIT');throw failure;} const begin = performance.now(); requests++;currentChunk=request.chunk.index;currentPhase='waiting';report();options.onMetrics?.({prepareMs,apiMs,localMs:0,requests}); try { return await adapter(request); } catch (error) { if (error instanceof ApiError) failure = error; throw error; } finally { apiMs += performance.now() - begin;currentPhase='validating';report();options.onMetrics?.({prepareMs,apiMs,localMs:0,requests}); } }, { ...options, signal, splitTruncated: true, onPrepared: ms => { prepareMs = ms; options.onPrepared?.(ms); } }); }
  catch (error) { if(deadline.signal.aborted && !options.signal?.aborted){const timed=new ApiError('TIMEOUT');if(error instanceof AnalysisError)Object.assign(timed,{checkpoints:error.checkpoints});throw timed;} if (failure && error instanceof AnalysisError && error.code === 'SERVICE_FAILED') { Object.assign(failure, { checkpoints: error.checkpoints }); throw failure; } throw error; }
  finally { clearTimeout(deadlineTimer);options.onMetrics?.({ prepareMs, apiMs, localMs: Math.max(0, performance.now() - started - prepareMs - apiMs), requests }); }
}
function compactReferences(request: string): { prompt: string; ids: Map<string, string>; ranges: Map<string, SourceRef> } {
  const ids = new Map<string, string>(), aliases = new Map<string, string>(), ranges = new Map<string, SourceRef>();
  try {
    const newline = request.indexOf('\n'); if (newline < 0) return { prompt: request, ids, ranges };
    const payload = JSON.parse(request.slice(newline + 1));
    if (!Array.isArray(payload.core) || !Array.isArray(payload.context)) return { prompt: request, ids, ranges };
    for (const ref of [...payload.core, ...payload.context]) {
      if (!ref || typeof ref.segmentId !== 'string') return { prompt: request, ids: new Map(), ranges: new Map() };
      let alias = aliases.get(ref.segmentId);
      if (!alias) { alias = `s${aliases.size + 1}`; aliases.set(ref.segmentId, alias); ids.set(alias, ref.segmentId); }
      const refId = `r${ranges.size + 1}`;
      ranges.set(refId, {segmentId:ref.segmentId,startOffset:ref.startOffset,endOffset:ref.endOffset});
      ref.refId = refId;
      ref.segmentId = alias;
    }
    return { prompt: request.slice(0, newline).replace('refs:[{segmentId,startOffset,endOffset}]，偏移是片段内 UTF-16 半开区间，只引用本次提供的范围，不生成时间。', 'refs:["r1"]，只选择本次给定的 refId，不输出或计算坐标，不生成时间。') + ' refs 必须为 refId 字符串数组，不能使用 segmentId 或坐标对象。\n' + JSON.stringify(payload), ids, ranges };
  } catch { return { prompt: request, ids: new Map(), ranges: new Map() }; }
}
function restoreReferences(text: string, ids: Map<string, string>, ranges: Map<string, SourceRef>): unknown {
  if (!ids.size) return text;
  try {
    const value: unknown = JSON.parse(text); const stack: unknown[] = [value]; let visited = 0;
    while (stack.length) {
      const item = stack.pop(); if (!item || typeof item !== 'object') continue;
      if (++visited > 100000) return text;
      if (Array.isArray(item)) { stack.push(...item); continue; }
      const object = item as Record<string, unknown>;
      if (Array.isArray(object.refs)) object.refs = object.refs.map(ref => typeof ref === 'string' && ranges.has(ref) ? {...ranges.get(ref)!} : ref);
      if (typeof object.segmentId === 'string' && ids.has(object.segmentId)) object.segmentId = ids.get(object.segmentId)!;
      for (const child of Object.values(object)) if (child && typeof child === 'object') stack.push(child);
    }
    return value;
  } catch { return text; }
}
function waitForSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    // Observe both outcomes even after cancellation so a late rejection is handled.
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
export function createApiAdapter(credentials: ApiConfigInput, timeoutMs = 60000, onReceiving?:()=>void): AnalysisAdapter {
  const config = { ...credentials };
  const model = { id: config.model, name: config.model, api: 'openai-completions' as const, provider: 'clipnote-api', baseUrl: config.baseUrl, reasoning: false, input: ['text' as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: config.contextWindow, maxTokens: config.maxTokens };
  return async request => {
    if (request.signal?.aborted) throw new ApiError('CANCELLED');
    const compact = compactReferences(request.chunk.request);
    const prompt = compact.prompt + (request.repair ? '\n上次结果格式错误。请仅输出符合要求的完整 JSON，不要添加代码围栏。' : '\n请仅输出完整 JSON，不要添加代码围栏。');
    if (Buffer.byteLength(prompt, 'utf8') > config.contextWindow - config.maxTokens - 512) throw new ApiError('INVALID_CONFIG');
    let status: number | undefined, streamFailed = false; const timeout = AbortSignal.timeout(timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    try {
      const { createModels, createProvider } = await import('@earendil-works/pi-ai');
      const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');
      const models = createModels();
      models.setProvider(createProvider({ id: 'clipnote-api', name: 'ClipNote API', baseUrl: config.baseUrl, auth: { apiKey: { name: 'Configured API', resolve: async () => ({ auth: { apiKey: config.apiKey } }) } }, models: [model], api: openAICompletionsApi() }));
      signal.throwIfAborted();
      const response = await waitForSignal(models.completeSimple(models.getModel('clipnote-api', config.model)!, { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] }, { maxTokens: config.maxTokens, maxRetries: 0, signal, fetch: async (input, init) => {
        const result = await fetch(input, { ...init, redirect: 'error' }); status = result.status;
        if (signal.aborted) { await result.body?.cancel(); signal.throwIfAborted(); }
        if (!result.body) return result;
        const reader = result.body.getReader(); let size = 0; let received=false; const limit = Math.min(4 * 1024 * 1024, Math.max(1024 * 1024, request.profile.outputCharBudget * 64));
        const bounded = new ReadableStream<Uint8Array>({ async pull(controller) { try { const part = await reader.read(); if (part.done) { controller.close(); return; } if(!received){received=true;onReceiving?.();}size += part.value.byteLength; if (size > limit) { await reader.cancel(); controller.error(new Error('response limit exceeded')); return; } controller.enqueue(part.value); } catch (error) { streamFailed = true; controller.error(error); } }, cancel() { return reader.cancel(); } });
        return new Response(bounded, { status: result.status, statusText: result.statusText, headers: result.headers });
      } }), signal);
      if (request.signal?.aborted) throw new ApiError('CANCELLED');
      if (timeout.aborted) throw new ApiError('TIMEOUT');
      if (streamFailed && response.stopReason !== 'stop' && response.stopReason !== 'length') throw new ApiError('NETWORK');
      if (status === 400 || status === 404 || status === 422) throw new ApiError('INVALID_CONFIG'); if (status === 401) throw new ApiError('AUTH_FAILED'); if (status === 402) throw new ApiError('BALANCE'); if (status === 403) throw new ApiError('PERMISSION_DENIED'); if (status === 408) throw new ApiError('TIMEOUT'); if (status === 429) throw new ApiError('RATE_LIMIT'); if (status && status >= 500) throw new ApiError('SERVER_ERROR'); if (status && status >= 400) throw new ApiError('NETWORK');
      if (response.stopReason === 'length') return { status: 'truncated', value: null };
      if (response.stopReason !== 'stop') throw new ApiError(status && status >= 200 && status < 300 ? 'INVALID_RESPONSE' : 'NETWORK');
      const text = response.content.filter(part => part.type === 'text').map(part => part.text).join('').trim();
      if (!text || text.length > request.profile.outputCharBudget) throw new ApiError('INVALID_RESPONSE');
      return { status: 'completed', value: restoreReferences(text, compact.ids, compact.ranges) };
    } catch (error) { throw error instanceof ApiError ? error : new ApiError(request.signal?.aborted ? 'CANCELLED' : timeout.aborted ? 'TIMEOUT' : 'NETWORK'); }
  };
}
