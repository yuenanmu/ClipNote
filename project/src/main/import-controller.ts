import type { SourceDocument } from '../contracts/source.ts';
import type { ImportResult } from '../contracts/desktop.ts';
import { SourceImportError } from '../modules/source/errors.ts';
interface Dependencies {
  isTrustedSender(event: unknown): boolean;
  chooseFile(): Promise<string | undefined>;
  loadFile(path: string): Promise<SourceDocument>;
}
export function createImportHandler(dependencies: Dependencies): (event: unknown, ...args: unknown[]) => Promise<ImportResult> {
  let busy = false;
  return async (event, ...args) => {
    if (!dependencies.isTrustedSender(event) || args.length) return { status: 'error', error: { code: 'FORBIDDEN_REQUEST', message: '无法执行此导入请求。' } };
    if (busy) return { status: 'error', error: { code: 'IMPORT_BUSY', message: '正在导入，请稍候。' } };
    busy = true;
    try {
      const file = await dependencies.chooseFile();
      if (!file) return { status: 'cancelled' };
      return { status: 'imported', document: await dependencies.loadFile(file) };
    } catch (error) {
      if (error instanceof SourceImportError) return { status: 'error', error: { code: error.code, message: error.message } };
      return { status: 'error', error: { code: 'IMPORT_FAILED', message: '文件导入未完成，请重试。' } };
    } finally { busy = false; }
  };
}
