import type { AnalysisAdapter } from '../../contracts/analysis.ts';
import type { ApiConfigInput } from '../../contracts/api.ts';
import { ApiError } from './errors.ts';
import type { SourceDocument } from '../../contracts/source.ts';
import type { AnalysisOptions, AnalysisResult } from '../../contracts/analysis.ts';
import { createHash } from 'node:crypto';
import { analyzeSource } from '../analysis/run.ts';
import { AnalysisError } from '../analysis/errors.ts';
export async function analyzeWithApi(source: SourceDocument, credentials: ApiConfigInput, options: AnalysisOptions = {}): Promise<AnalysisResult> {
  const inputCharBudget = Math.max(1000, Math.min(16000, Math.floor((credentials.contextWindow - credentials.maxTokens - 512) / 3)));
  const profile = { provider: `api:${createHash('sha256').update(credentials.baseUrl).digest('hex')}`, model: credentials.model, promptVersion: 't06-v1', inputCharBudget, outputCharBudget: 64000, overlapChars: 0, inputByteBudget: Math.min(512000, credentials.contextWindow - credentials.maxTokens - 612) };
  const adapter = createApiAdapter(credentials); let failure: ApiError | undefined;
  try { return await analyzeSource(source, profile, async request => { try { return await adapter(request); } catch (error) { if (error instanceof ApiError) failure = error; throw error; } }, options); }
  catch (error) { if (failure && error instanceof AnalysisError && error.code === 'SERVICE_FAILED') { Object.assign(failure, { checkpoints: error.checkpoints }); throw failure; } throw error; }
}
export function createApiAdapter(credentials: ApiConfigInput): AnalysisAdapter {
  const config = { ...credentials };
  const model = { id: config.model, name: config.model, api: 'openai-completions' as const, provider: 'clipnote-api', baseUrl: config.baseUrl, reasoning: false, input: ['text' as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: config.contextWindow, maxTokens: config.maxTokens };
  return async request => {
    if (request.signal?.aborted) throw new ApiError('CANCELLED');
    const prompt = request.chunk.request + (request.repair ? '\n上次结果格式错误。请仅输出符合要求的完整 JSON，不要添加代码围栏。' : '\n请仅输出完整 JSON，不要添加代码围栏。');
    if (Buffer.byteLength(prompt, 'utf8') > config.contextWindow - config.maxTokens - 512) throw new ApiError('INVALID_CONFIG');
    let status: number | undefined;
    try {
      const { createModels, createProvider } = await import('@earendil-works/pi-ai');
      const { openAICompletionsApi } = await import('@earendil-works/pi-ai/api/openai-completions.lazy');
      const models = createModels();
      models.setProvider(createProvider({ id: 'clipnote-api', name: 'ClipNote API', baseUrl: config.baseUrl, auth: { apiKey: { name: 'Configured API', resolve: async () => ({ auth: { apiKey: config.apiKey } }) } }, models: [model], api: openAICompletionsApi() }));
      const timeout = AbortSignal.timeout(60000);
      const response = await models.completeSimple(models.getModel('clipnote-api', config.model)!, { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }] }, { maxTokens: config.maxTokens, maxRetries: 0, signal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout, fetch: async (input, init) => {
        const result = await fetch(input, { ...init, redirect: 'error' }); status = result.status;
        if (!result.body) return result;
        const reader = result.body.getReader(); let size = 0; const limit = Math.min(4 * 1024 * 1024, Math.max(1024 * 1024, request.profile.outputCharBudget * 64));
        const bounded = new ReadableStream<Uint8Array>({ async pull(controller) { try { const part = await reader.read(); if (part.done) { controller.close(); return; } size += part.value.byteLength; if (size > limit) { await reader.cancel(); controller.error(new Error('response limit exceeded')); return; } controller.enqueue(part.value); } catch (error) { controller.error(error); } }, cancel() { return reader.cancel(); } });
        return new Response(bounded, { status: result.status, statusText: result.statusText, headers: result.headers });
      } });
      if (request.signal?.aborted) throw new ApiError('CANCELLED');
      if (timeout.aborted) throw new ApiError('NETWORK');
      if (status === 400 || status === 404) throw new ApiError('INVALID_CONFIG'); if (status === 401) throw new ApiError('AUTH_FAILED'); if (status === 403) throw new ApiError('PERMISSION_DENIED'); if (status === 429) throw new ApiError('QUOTA'); if (status && status >= 400) throw new ApiError('NETWORK');
      if (response.stopReason === 'length') return { status: 'truncated', value: null };
      if (response.stopReason !== 'stop') throw new ApiError(status && status >= 200 && status < 300 ? 'INVALID_RESPONSE' : 'NETWORK');
      const text = response.content.filter(part => part.type === 'text').map(part => part.text).join('').trim();
      if (!text || text.length > request.profile.outputCharBudget) throw new ApiError('INVALID_RESPONSE');
      return { status: 'completed', value: text };
    } catch (error) { throw error instanceof ApiError ? error : new ApiError(request.signal?.aborted ? 'CANCELLED' : 'NETWORK'); }
  };
}
