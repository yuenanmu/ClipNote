import type { ChunkCheckpoint } from '../../contracts/analysis.ts';
export type AnalysisErrorCode = 'INVALID_PROFILE' | 'INVALID_SOURCE' | 'TOO_LARGE' | 'INVALID_STRUCTURE' | 'INVALID_REFERENCE' | 'TRUNCATED' | 'CANCELLED' | 'SERVICE_FAILED' | 'INVALID_CHECKPOINT';
const messages: Record<AnalysisErrorCode, string> = {
  INVALID_PROFILE: '分析预算或服务标识无效。', INVALID_SOURCE: '来源结构无效。', TOO_LARGE: '分析内容超过安全上限。',
  INVALID_STRUCTURE: '分析结构不合格，已保留完成分块。', INVALID_REFERENCE: '分析引用无法对应所提供的原文。',
  TRUNCATED: '服务输出被截断，不能作为完整笔记。', CANCELLED: '分析已取消，已保留完成分块。',
  SERVICE_FAILED: '分析调用失败，已保留完成分块；请手动重试。', INVALID_CHECKPOINT: '检查点与当前分析计划不一致。',
};
export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode;
  readonly checkpoints: ChunkCheckpoint[];
  constructor(code: AnalysisErrorCode, checkpoints: ChunkCheckpoint[] = []) { super(messages[code]); this.name = 'AnalysisError'; this.code = code; this.checkpoints = structuredClone(checkpoints); }
}
