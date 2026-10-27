import { ApiError } from './errors.ts';
import { normalizeBaseUrl } from './config.ts';
export async function resolveModelKey(store: { state(): Promise<{ configured: boolean; baseUrl?: string }>; credentials(): Promise<{ apiKey: string }> }, baseUrl: string, apiKey: string): Promise<string> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (apiKey) return apiKey;
  const state = await store.state(); if (!state.configured || state.baseUrl !== normalized) throw new ApiError('KEY_REQUIRED');
  return (await store.credentials()).apiKey;
}
export async function listModels(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const base = normalizeBaseUrl(baseUrl);
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(apiKey)) throw new ApiError('KEY_REQUIRED');
  try {
    const result = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (result.status === 401) throw new ApiError('AUTH_FAILED'); if (result.status === 402) throw new ApiError('BALANCE'); if (result.status === 403) throw new ApiError('PERMISSION_DENIED'); if (result.status === 429) throw new ApiError('RATE_LIMIT'); if (result.status === 400 || result.status === 404 || result.status === 422) throw new ApiError('INVALID_CONFIG'); if (!result.ok) throw new ApiError('NETWORK');
    if (!result.body) throw new ApiError('INVALID_RESPONSE');
    const reader = result.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new ApiError('INVALID_RESPONSE'); } chunks.push(part.value); }
    let payload: any; try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError('INVALID_RESPONSE'); }
    if (!payload || !Array.isArray(payload.data) || payload.data.length > 10000) throw new ApiError('INVALID_RESPONSE');
    const ids: string[] = (payload.data as unknown[]).map((item: any) => item?.id).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128 && !/[\x00-\x20\x7f]/.test(id));
    return [...new Set(ids)].sort();
  } catch (error) { throw error instanceof ApiError ? error : new ApiError(signal?.aborted ? 'CANCELLED' : 'NETWORK'); }
}
