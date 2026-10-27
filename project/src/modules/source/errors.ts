export type SourceErrorCode = 'EMPTY_FILE' | 'UNSUPPORTED_FORMAT' | 'INVALID_ENCODING' | 'INVALID_SUBTITLE' | 'FILE_TOO_LARGE' | 'TOO_MANY_SEGMENTS' | 'FILE_UNREADABLE';
const messages: Record<SourceErrorCode, string> = {
  EMPTY_FILE: '文件中没有可导入的文字。',
  UNSUPPORTED_FORMAT: '请选择 SRT、VTT、TXT 或 MD 文件。',
  INVALID_ENCODING: '无法可靠识别文件编码，请另存为 UTF-8 文本后重试。',
  INVALID_SUBTITLE: '字幕格式不完整或时间范围有误，请检查文件后重试。',
  FILE_TOO_LARGE: '文件超过 16 MiB，请拆分后再导入。',
  TOO_MANY_SEGMENTS: '文件超过 20,000 个片段，请拆分后再导入。',
  FILE_UNREADABLE: '无法读取文件，文件可能已移动或没有读取权限。',
};
export class SourceImportError extends Error {
  code: SourceErrorCode;
  constructor(code: SourceErrorCode) {
    super(messages[code]);
    this.name = 'SourceImportError';
    this.code = code;
  }
}
