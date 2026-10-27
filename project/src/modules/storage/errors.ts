export type StorageErrorCode = 'DIRECTORY_REQUIRED' | 'UNOWNED_DIRECTORY' | 'UNSAFE_PATH' | 'INVALID_REQUEST' | 'DAMAGED_DATA' | 'STORAGE_FULL' | 'STORAGE_DENIED' | 'COLLISION' | 'SAVE_FAILED';
const messages: Record<StorageErrorCode, string> = {
  DIRECTORY_REQUIRED: '请先选择保存目录。', UNOWNED_DIRECTORY: '所选位置已有不属于 ClipNote 的同名目录，请选择其他位置。',
  UNSAFE_PATH: '保存路径包含不受支持的链接或目录结构，请选择其他位置。', INVALID_REQUEST: '无法执行此保存请求。',
  DAMAGED_DATA: '归档或恢复草稿缺失、损坏，无法安全读取。', STORAGE_FULL: '磁盘空间不足，未确认保存成功；已准备的恢复草稿会保留。',
  STORAGE_DENIED: '目录无法写入，请检查权限或选择其他位置；已准备的恢复草稿会保留。', COLLISION: '版本位置已存在，未覆盖任何文件，请重试。',
  SAVE_FAILED: '保存未确认完成，已准备的恢复草稿会保留，可选择其他目录后重试。',
};
export class StorageError extends Error {
  code: StorageErrorCode; draftId?: string;
  constructor(code: StorageErrorCode, draftId?: string) { super(messages[code]); this.name = 'StorageError'; this.code = code; this.draftId = draftId; }
}
