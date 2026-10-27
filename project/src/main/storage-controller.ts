import type { StorageResult } from '../contracts/desktop.ts';
import { StorageError } from '../modules/storage/errors.ts';
import { isSourceId, isUuid } from '../modules/storage/io.ts';
export type StorageAction = 'state' | 'choose' | 'save' | 'resume' | 'open';
interface Dependencies {
  isTrustedSender(event: unknown): boolean;
  chooseDirectory(): Promise<string | undefined>;
  execute(action: StorageAction, args: unknown[]): Promise<unknown>;
}
export function createStorageHandlers(dependencies: Dependencies): Record<StorageAction, (event: unknown, ...args: unknown[]) => Promise<StorageResult<unknown>>> {
  let busy = false;
  const handler = (action: StorageAction) => async (event: unknown, ...args: unknown[]): Promise<StorageResult<unknown>> => {
    if (!dependencies.isTrustedSender(event)) return { status: 'error', error: { code: 'FORBIDDEN_REQUEST', message: '无法执行此保存请求。' } };
    const valid = action === 'state' || action === 'choose' ? args.length === 0 : action === 'save' ? args.length === 1 && isSourceId(args[0]) : action === 'resume' ? args.length === 1 && isUuid(args[0]) : args.length === 2 && isSourceId(args[0]) && isUuid(args[1]);
    if (!valid) return { status: 'error', error: { code: 'INVALID_REQUEST', message: '无法执行此保存请求。' } };
    if (busy) return { status: 'error', error: { code: 'STORAGE_BUSY', message: '正在处理保存操作，请稍候。' } };
    busy = true;
    try {
      if (action === 'choose') { const parent = await dependencies.chooseDirectory(); if (!parent) return { status: 'cancelled' }; args = [parent]; }
      return { status: 'ok', value: await dependencies.execute(action, args) };
    } catch (error) {
      const failure = error instanceof StorageError ? error : new StorageError('SAVE_FAILED');
      return { status: 'error', error: { code: failure.code, message: failure.message, ...(failure.draftId ? { draftId: failure.draftId } : {}) } };
    } finally { busy = false; }
  };
  return { state: handler('state'), choose: handler('choose'), save: handler('save'), resume: handler('resume'), open: handler('open') };
}
