import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { exists, isUuid, readJson, writeAtomic } from '../storage/io.ts';
import type { ApiConfigInput, ApiState, ApiProfileRef, ApiProfileInput, ApiProfilesView, ApiProfileView } from '../../contracts/api.ts';
import { ApiError } from './errors.ts';
export interface Protector { isAsyncEncryptionAvailable(): Promise<boolean>; encryptStringAsync(value: string): Promise<Buffer>; decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> }
interface StoredProfile extends ApiProfileView { encryptedKey: string }
interface Stored { version: 2; defaultId?: string; profiles: StoredProfile[] }
const LEGACY_ID = '00000000-0000-4000-8000-000000000001';
const MAX_PROFILES = 100;

export function isApiProfileRef(value: unknown): value is ApiProfileRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const {id,revision} = value as ApiProfileRef;
  return Object.keys(value).length === 2 && isUuid(id) && Number.isSafeInteger(revision) && revision > 0;
}
const profileName = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\x00-\x1f\x7f]/.test(value)) throw new ApiError('INVALID_CONFIG');
  return value.trim();
};
function view(profile: StoredProfile): ApiProfileView {
  const {encryptedKey: _, ...value} = profile;
  return value;
}
function settings(value: Omit<ApiConfigInput, 'apiKey'>): Omit<ApiConfigInput, 'apiKey'> {
  const { baseUrl, model, contextWindow, maxTokens } = value;
  return { baseUrl, model, contextWindow, maxTokens };
}
function storedConfig(raw: any) {
  const encryptedKey = raw.encryptedKey;
  if (typeof encryptedKey !== 'string' || !encryptedKey || !/^[A-Za-z0-9+/]+={0,2}$/.test(encryptedKey) || encryptedKey.length > 12000) throw new Error('invalid');
  const saved=settings(raw);
  validate({...saved,apiKey:'placeholder'});
  return {...saved,encryptedKey};
}
export function normalizeBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== 'string' || baseUrl.length > 2048) throw new ApiError('INVALID_CONFIG');
  let url: URL; try { url = new URL(baseUrl); } catch { throw new ApiError('INVALID_CONFIG'); }
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new ApiError('INVALID_CONFIG');
  return url.href.replace(/\/$/, '');
}
function validate(value: ApiConfigInput): Omit<ApiConfigInput, 'apiKey'> {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'apiKey,baseUrl,contextWindow,maxTokens,model' || typeof value.baseUrl !== 'string' || value.baseUrl.length > 2048 || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 128 || /[\x00-\x20\x7f]/.test(value.model) || typeof value.apiKey !== 'string' || value.apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(value.apiKey) || !Number.isSafeInteger(value.contextWindow) || value.contextWindow < 4096 || value.contextWindow > 1000000 || !Number.isSafeInteger(value.maxTokens) || value.maxTokens < 64 || value.maxTokens > 32768 || value.maxTokens > value.contextWindow / 2) throw new ApiError('INVALID_CONFIG');
  return { baseUrl: normalizeBaseUrl(value.baseUrl), model: value.model.trim(), contextWindow: value.contextWindow, maxTokens: value.maxTokens };
}
export class ApiConfigStore {
  private readonly path: string;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly protector:Protector;
  constructor(directory: string, protector: Protector) { this.path = join(directory, 'api.json'); this.protector=protector; }
  private async read(): Promise<Stored> {
    if (!await exists(this.path)) return {version:2, profiles:[]};
    try {
      const data = await readJson(this.path);
      if (data.version === 1 && Object.keys(data).sort().join(',') === 'baseUrl,contextWindow,encryptedKey,maxTokens,model,version') {
        const config = storedConfig(data);
        const name = new URL(config.baseUrl).hostname === 'api.deepseek.com' ? 'DeepSeek' : '原有 API 服务';
        return {version:2, defaultId:LEGACY_ID, profiles:[{...config, name, id:LEGACY_ID, revision:1}]};
      }
      if (data.version !== 2 || !Array.isArray(data.profiles) || data.profiles.length > MAX_PROFILES) throw new Error('invalid');
      const profiles = data.profiles.map(raw => {
        if (!raw || !isApiProfileRef({id:raw.id,revision:raw.revision})) throw new Error('invalid');
        return {...storedConfig(raw), name:profileName(raw.name), id:raw.id as string, revision:raw.revision as number};
      });
      if (new Set(profiles.map(p=>p.id)).size !== profiles.length ||
          (data.defaultId !== undefined && !profiles.some(p=>p.id===data.defaultId))) throw new Error('invalid');
      return {version:2, defaultId:data.defaultId, profiles};
    } catch { throw new ApiError('CONFIG_DAMAGED'); }
  }
  private change<T>(operation: (data:Stored)=>Promise<T>): Promise<T> {
    const value=this.writes.then(async()=>{
      const data=await this.read(), result=await operation(data);
      try { await writeAtomic(this.path,data); } catch { throw new ApiError('CONFIG_FAILED'); }
      return result;
    });
    this.writes=value.catch(()=>{});
    return value;
  }
  private async requireEncryption() {
    try { if (!await this.protector.isAsyncEncryptionAvailable()) throw new Error(); }
    catch { throw new ApiError('ENCRYPTION_UNAVAILABLE'); }
  }
  async profiles(): Promise<ApiProfilesView> {
    const {defaultId,profiles}=await this.read();
    return {defaultId,profiles:profiles.map(view)};
  }
  private find(data:Stored, ref?:ApiProfileRef) {
    const value=data.profiles.find(profile=>profile.id===(ref?.id??data.defaultId));
    if (ref && (!value || value.revision!==ref.revision)) throw new ApiError('INVALID_CONFIG');
    return value;
  }
  async profile(ref?:ApiProfileRef): Promise<ApiProfileView | undefined> {
    const value=this.find(await this.read(),ref);
    return value && view(value);
  }
  async state(): Promise<ApiState> {
    const value=await this.profile();
    return value ? {configured:true,...settings(value)} : {configured:false};
  }
  private async store(data:Stored, input:ApiConfigInput, name:string, previous?:StoredProfile) {
    const config=validate(input);
    if(previous?.baseUrl===input.baseUrl)config.baseUrl=previous.baseUrl;
    if (!input.apiKey && (!previous || previous.baseUrl!==config.baseUrl)) throw new ApiError('KEY_REQUIRED');
    if (!previous && data.profiles.length>=MAX_PROFILES) throw new ApiError('INVALID_CONFIG');
    await this.requireEncryption();
    let encryptedKey:string;
    try { encryptedKey=input.apiKey ? (await this.protector.encryptStringAsync(input.apiKey)).toString('base64') : previous!.encryptedKey; }
    catch { throw new ApiError('ENCRYPTION_UNAVAILABLE'); }
    const changed=!previous || !!input.apiKey || JSON.stringify(settings(previous))!==JSON.stringify(config);
    const value={...config,name,encryptedKey,id:previous?.id??randomUUID(),revision:previous ? previous.revision+Number(changed) : 1};
    if (previous) data.profiles=data.profiles.map(profile=>profile.id===value.id ? value : profile);
    else {
      if (!data.profiles.length) data.defaultId=value.id;
      data.profiles.push(value);
    }
    return value;
  }
  save(input: ApiConfigInput): Promise<ApiState> {
    return this.change(async data=>{
      const previous=this.find(data);
      const saved=await this.store(data,input,previous?.name??'API 服务',previous);
      data.defaultId=saved.id;
      return {configured:true,...settings(saved)};
    });
  }
  saveProfile(input: ApiProfileInput): Promise<ApiProfileView> {
    return this.change(async data=>{
      if (!input || typeof input!=='object') throw new ApiError('INVALID_CONFIG');
      const {id,revision,name,...config}=input;
      const ref={id,revision};
      if ((id!==undefined || revision!==undefined) && !isApiProfileRef(ref)) throw new ApiError('INVALID_CONFIG');
      return view(await this.store(data,config,profileName(name),isApiProfileRef(ref)?this.find(data,ref):undefined));
    });
  }
  setDefault(id:string): Promise<null> {
    return this.change(async data=>{
      if (!data.profiles.some(profile=>profile.id===id)) throw new ApiError('INVALID_CONFIG');
      data.defaultId=id;
      return null;
    });
  }
  deleteProfile(ref:ApiProfileRef): Promise<null> {
    return this.change(async data=>{
      this.find(data,ref);
      data.profiles=data.profiles.filter(profile=>profile.id!==ref.id);
      if (data.defaultId===ref.id) delete data.defaultId;
      return null;
    });
  }
  async credentials(ref?:ApiProfileRef, expectedBaseUrl?:string): Promise<ApiConfigInput> {
    const data=this.find(await this.read(),ref);
    if (!data || (expectedBaseUrl!==undefined && data.baseUrl!==expectedBaseUrl)) throw new ApiError('KEY_REQUIRED');
    await this.requireEncryption();
    try {
      const {result:apiKey}=await this.protector.decryptStringAsync(Buffer.from(data.encryptedKey,'base64'));
      if (!apiKey) throw new Error();
      return {...settings(data),apiKey};
    } catch { throw new ApiError('CONFIG_DAMAGED'); }
  }
}
