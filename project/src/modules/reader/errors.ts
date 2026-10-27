export type ReaderErrorCode = 'READER_UNREADABLE' | 'READER_TOO_LARGE' | 'READER_TOO_COMPLEX' | 'READER_ENCODING' | 'READER_INVALID_REQUEST' | 'READER_EXPIRED' | 'READER_BUSY' | 'READER_EXTERNAL_FAILED';
const messages: Record<ReaderErrorCode, string> = {
  READER_UNREADABLE: '无法读取此 Markdown 或归档来源，请检查文件是否存在且可访问。',
  READER_TOO_LARGE: 'Markdown 超过阅读上限（2 MiB），请使用外部编辑器查看。',
  READER_TOO_COMPLEX: 'Markdown 结构过多或嵌套过深，请使用外部编辑器查看。',
  READER_ENCODING: '无法可靠解码此 Markdown，请检查文件编码。',
  READER_INVALID_REQUEST: '无法执行此阅读请求。', READER_EXPIRED: '阅读会话已失效，请重新打开文件。',
  READER_BUSY: '正在处理阅读操作，请稍候。', READER_EXTERNAL_FAILED: '无法打开外部程序，请检查系统默认应用设置。',
};
export class ReaderError extends Error {
  code: ReaderErrorCode;
  constructor(code: ReaderErrorCode = 'READER_UNREADABLE') { super(messages[code] ?? messages.READER_UNREADABLE); this.code = code in messages ? code : 'READER_UNREADABLE'; }
}
