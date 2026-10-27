import { join } from 'node:path';
import { exists, readJson, writeAtomic } from '../storage/io.ts';
import type { ApiConfigInput, ApiState } from '../../contracts/api.ts';
import { ApiError } from './errors.ts';
export interface Protector { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
interface Stored { version: 1; baseUrl: string; model: string; contextWindow: number; maxTokens: number; encryptedKey: string }
function validate(value: ApiConfigInput): Omit<ApiConfigInput, 'apiKey'> {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'apiKey,baseUrl,contextWindow,maxTokens,model' || typeof value.baseUrl !== 'string' || value.baseUrl.length > 2048 || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 128 || /[\x00-\x20\x7f]/.test(value.model) || typeof value.apiKey !== 'string' || value.apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(value.apiKey) || !Number.isSafeInteger(value.contextWindow) || value.contextWindow < 4096 || value.contextWindow > 1000000 || !Number.isSafeInteger(value.maxTokens) || value.maxTokens < 64 || value.maxTokens > 32768 || value.maxTokens > value.contextWindow / 2) throw new ApiError('INVALID_CONFIG');
  let url: URL; try { url = new URL(value.baseUrl); } catch { throw new ApiError('INVALID_CONFIG'); }
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new ApiError('INVALID_CONFIG');
  return { baseUrl: url.href.replace(/\/$/, ''), model: value.model.trim(), contextWindow: value.contextWindow, maxTokens: value.maxTokens };
}
export class ApiConfigStore {
  private readonly path: string; private readonly protector: Protector;
  constructor(directory: string, protector: Protector) { this.path = join(directory, 'api.json'); this.protector = protector; }
  private async read(): Promise<Stored | undefined> {
    if (!await exists(this.path)) return;
    try {
      const data = await readJson(this.path);
      if (Object.keys(data).sort().join(',') !== 'baseUrl,contextWindow,encryptedKey,maxTokens,model,version' || data.version !== 1 || typeof data.encryptedKey !== 'string' || !data.encryptedKey || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.encryptedKey) || data.encryptedKey.length > 12000) throw new Error('invalid');
      validate({ baseUrl: data.baseUrl, model: data.model, contextWindow: data.contextWindow, maxTokens: data.maxTokens, apiKey: 'placeholder' });
      return data as Stored;
    } catch { throw new ApiError('CONFIG_DAMAGED'); }
  }
  async state(): Promise<ApiState> { const data = await this.read(); return data ? { configured: true, baseUrl: data.baseUrl, model: data.model, contextWindow: data.contextWindow, maxTokens: data.maxTokens } : { configured: false }; }
  async save(value: ApiConfigInput): Promise<ApiState> {
    const config = validate(value); const old = await this.read();
    if (!value.apiKey && (!old || old.baseUrl !== config.baseUrl)) throw new ApiError('KEY_REQUIRED');
    if (!this.protector.isEncryptionAvailable()) throw new ApiError('ENCRYPTION_UNAVAILABLE');
    let encryptedKey: string; try { encryptedKey = value.apiKey ? this.protector.encryptString(value.apiKey).toString('base64') : old!.encryptedKey; } catch { throw new ApiError('ENCRYPTION_UNAVAILABLE'); }
    try { await writeAtomic(this.path, { version: 1, ...config, encryptedKey }); } catch { throw new ApiError('CONFIG_FAILED'); }
    return { configured: true, ...config };
  }
  async credentials(): Promise<ApiConfigInput> {
    const data = await this.read(); if (!data) throw new ApiError('KEY_REQUIRED');
    if (!this.protector.isEncryptionAvailable()) throw new ApiError('ENCRYPTION_UNAVAILABLE');
    try { const apiKey = this.protector.decryptString(Buffer.from(data.encryptedKey, 'base64')); if (!apiKey) throw new Error(); return { baseUrl: data.baseUrl, model: data.model, contextWindow: data.contextWindow, maxTokens: data.maxTokens, apiKey }; } catch { throw new ApiError('CONFIG_DAMAGED'); }
  }
}
