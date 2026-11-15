import { isUuid } from '../modules/storage/io.ts';
import { WorkspaceError } from '../modules/workspace/files.ts';
export function createWorkspaceHandler(dependencies: { isTrustedSender(event: unknown): boolean; execute(kind: string, action: string, args: unknown[]): Promise<unknown> }) {
  let busy = false;
  return async (event: unknown, kind: unknown, action: unknown, ...args: unknown[]): Promise<any> => {
    const fail = (code: string, message: string) => ({ status: 'error', error: { code, message } });
    if (!dependencies.isTrustedSender(event) || !['source','notes'].includes(kind as string) || typeof action !== 'string') return fail('INVALID_REQUEST', '无法执行文件操作。');
    const noArgs = ['root','choose'].includes(action) && args.length === 0;
    const oneId = action === 'trash' && args.length === 1 && isUuid(args[0]);
    const list = action === 'list' && (args.length === 1 || args.length === 2) && isUuid(args[0]) && (args.length === 1 || (Number.isSafeInteger(args[1]) && (args[1] as number) >= 0));
    const search = action === 'search' && args.length === 1 && typeof args[0] === 'string' && args[0].trim().length > 0 && args[0].length <= 100;
    const noteId = kind === 'notes' && action === 'read' && args.length === 1 && isUuid(args[0]);
    const importId = ['import','entry'].includes(action) && args.length === 1 && isUuid(args[0]);
    const named = ['mkdir','rename'].includes(action) && args.length === 2 && isUuid(args[0]) && typeof args[1] === 'string' && args[1].length <= 200;
    const create = kind === 'notes' && action === 'create' && args.length === 2 && isUuid(args[0]) && typeof args[1] === 'string' && args[1].length <= 200;
    const move = action === 'move' && args.length === 2 && isUuid(args[0]) && isUuid(args[1]);
    const many=['moveMany','trashMany'].includes(action) && args.length===(action==='moveMany'?2:1) && Array.isArray(args[0]) && args[0].length>0 && args[0].length<=10000 && args[0].every(isUuid) && new Set(args[0]).size===args[0].length && (action!=='moveMany' || isUuid(args[1]));
    const associate = kind === 'source' && action === 'associate' && args.length === 2 && isUuid(args[0]) && isUuid(args[1]);
    const save = kind === 'notes' && action === 'save' && args.length === 3 && isUuid(args[0]) && typeof args[1] === 'string' && typeof args[2] === 'string' && args[2].length <= 2 * 1024 * 1024;
    if (!(noArgs || oneId || list || search || noteId || importId || named || create || move || many || associate || save)) return fail('INVALID_REQUEST', '无法执行文件操作。');
    if (busy) return fail('BUSY', '正在处理文件操作，请稍候。'); busy = true;
    try { const value = await dependencies.execute(kind as string, action, args); return value === undefined && action === 'choose' ? { status: 'cancelled' } : { status: 'ok', value }; }
    catch (error) {
      const code = error instanceof WorkspaceError ? error.code : (error as NodeJS.ErrnoException)?.code;
      if(code==='BUSY')return fail('BUSY','此文件或目录正用于整理任务，完成或取消后可操作。');
      if(code==='ASSOCIATION_LOST' || code==='RELINK_REQUIRED')return fail('RELINK_REQUIRED','实际文件操作已执行，但关联登记未完成。请刷新目录并重新关联笔记。');
      if(code==='ROOT_IN_USE')return fail('ROOT_IN_USE','此目录正在作为资料或笔记根目录使用，请先更换该区域的根目录。');
      if (['CONFLICT','EEXIST'].includes(code ?? '')) return fail('CONFLICT', '文件已存在或已被外部修改，请刷新后重试。');
      if (['INVALID_NAME'].includes(code ?? '')) return fail('INVALID_NAME', '文件或文件夹名称无效。');
      if (code === 'ENCODING') return fail('ENCODING', '当前只能编辑 UTF-8 Markdown；请使用外部编辑器处理此文件。');
      if (['ENOENT'].includes(code ?? '')) return fail('MISSING', '文件或文件夹不存在，请刷新。');
      if (['EACCES','EPERM','EROFS'].includes(code ?? '')) return fail('DENIED', '没有访问权限，请检查文件夹权限。');
      return fail('WORKSPACE_FAILED', '文件操作未完成，请检查路径和权限。');
    } finally { busy = false; }
  };
}
