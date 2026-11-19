import type { ApiConfigInput, ApiResult, ApiState, ApiProfileRef, ApiProfileInput, ApiModelsInput } from '../contracts/api.ts';
import {isApiProfileRef,type ApiConfigStore} from '../modules/api/config.ts';
import {isUuid} from '../modules/storage/io.ts';
import { ApiError } from '../modules/api/errors.ts';
interface Dependencies { isTrustedSender(event: unknown): boolean; store: Pick<ApiConfigStore,'state'|'save'> & Partial<Pick<ApiConfigStore,'profiles'|'saveProfile'|'setDefault'|'deleteProfile'>>; test(signal: AbortSignal, profile?:ApiProfileRef): Promise<void>; models?(input: ApiModelsInput, signal: AbortSignal): Promise<string[]> }
type Action='state'|'save'|'test'|'cancel'|'models'|'profiles'|'save-profile'|'set-default'|'delete-profile';
export function createApiHandlers(deps: Dependencies): Record<Action, (event: unknown, ...args: unknown[]) => Promise<ApiResult<any>>> {
  let busy = false; let active: AbortController | undefined;
  const handle = (action: Action) => async (event: unknown, ...args: unknown[]): Promise<ApiResult<any>> => {
    const fail = (error: ApiError): ApiResult<never> => ({ status: 'error', error: { code: error.code, message: error.message } });
    if (!deps.isTrustedSender(event) || (action==='test' ? args.length>1 || (args.length===1 && !isApiProfileRef(args[0])) : ['state','cancel','profiles'].includes(action) ? args.length!==0 : args.length!==1)) return fail(new ApiError('FORBIDDEN_REQUEST'));
    if (action === 'cancel') { active?.abort(); return { status: 'ok', value: null }; }
    if (busy) return fail(new ApiError('BUSY')); busy = true;
    try {
      if (action==='profiles' && deps.store.profiles) return {status:'ok',value:await deps.store.profiles()};
      if (action==='save-profile' && deps.store.saveProfile) return {status:'ok',value:await deps.store.saveProfile(args[0] as ApiProfileInput)};
      if (action==='set-default' && deps.store.setDefault && isUuid(args[0])) return {status:'ok',value:await deps.store.setDefault(args[0])};
      if (action==='delete-profile' && deps.store.deleteProfile && isApiProfileRef(args[0])) return {status:'ok',value:await deps.store.deleteProfile(args[0])};
      if (['profiles','save-profile','set-default','delete-profile'].includes(action)) throw new ApiError('INVALID_CONFIG');
      if (action === 'state') return { status: 'ok', value: await deps.store.state() };
      if (action === 'save') return { status: 'ok', value: await deps.store.save(args[0] as ApiConfigInput) };
      if (action === 'models') { const input = args[0] as Record<string, unknown>; if (!input || typeof input !== 'object' || !['apiKey,baseUrl','apiKey,baseUrl,profile'].includes(Object.keys(input).sort().join(',')) || ('profile' in input && input.profile!==null && !isApiProfileRef(input.profile)) || typeof input.baseUrl !== 'string' || typeof input.apiKey !== 'string' || !deps.models) throw new ApiError('INVALID_CONFIG'); active = new AbortController(); const value = await deps.models({ baseUrl: input.baseUrl, apiKey: input.apiKey, profile:input.profile as ApiModelsInput['profile'] }, active.signal); if (active.signal.aborted) throw new ApiError('CANCELLED'); return { status: 'ok', value }; }
      active = new AbortController(); await deps.test(active.signal,args[0] as ApiProfileRef|undefined); if (active.signal.aborted) throw new ApiError('CANCELLED'); return { status: 'ok', value: null };
    } catch (error) { return fail(error instanceof ApiError ? error : new ApiError('CONFIG_FAILED')); }
    finally { busy = false; active = undefined; }
  };
  return { state: handle('state'), save: handle('save'), test: handle('test'), cancel: handle('cancel'), models: handle('models'),profiles:handle('profiles'),'save-profile':handle('save-profile'),'set-default':handle('set-default'),'delete-profile':handle('delete-profile') };
}
