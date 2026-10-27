import type { ApiConfigInput, ApiResult, ApiState } from '../contracts/api.ts';
import { ApiError } from '../modules/api/errors.ts';
interface Dependencies { isTrustedSender(event: unknown): boolean; store: { state(): Promise<ApiState>; save(input: ApiConfigInput): Promise<ApiState> }; test(signal: AbortSignal): Promise<void> }
export function createApiHandlers(deps: Dependencies): Record<'state' | 'save' | 'test' | 'cancel', (event: unknown, ...args: unknown[]) => Promise<ApiResult<any>>> {
  let busy = false; let active: AbortController | undefined;
  const handle = (action: 'state' | 'save' | 'test' | 'cancel') => async (event: unknown, ...args: unknown[]): Promise<ApiResult<any>> => {
    const fail = (error: ApiError): ApiResult<never> => ({ status: 'error', error: { code: error.code, message: error.message } });
    if (!deps.isTrustedSender(event) || (action === 'save' ? args.length !== 1 : args.length !== 0)) return fail(new ApiError('FORBIDDEN_REQUEST'));
    if (action === 'cancel') { active?.abort(); return { status: 'ok', value: null }; }
    if (busy) return fail(new ApiError('BUSY')); busy = true;
    try {
      if (action === 'state') return { status: 'ok', value: await deps.store.state() };
      if (action === 'save') return { status: 'ok', value: await deps.store.save(args[0] as ApiConfigInput) };
      active = new AbortController(); await deps.test(active.signal); if (active.signal.aborted) throw new ApiError('CANCELLED'); return { status: 'ok', value: null };
    } catch (error) { return fail(error instanceof ApiError ? error : new ApiError('CONFIG_FAILED')); }
    finally { busy = false; active = undefined; }
  };
  return { state: handle('state'), save: handle('save'), test: handle('test'), cancel: handle('cancel') };
}
