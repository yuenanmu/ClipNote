export type SmartSubDiscovery = {installed:false}|{installed:true;path:string};
import type {SourceDocument} from './source.ts';
import type {SmartSubTaskStatus} from '../modules/smartsub/receipts.ts';
export type TranscriptionOutputIssue = 'empty' | 'missing';
export const transcriptionOutputMessages:Record<TranscriptionOutputIssue,string> = {
  empty:'SmartSub 已完成，但生成的字幕为空。可以重试转写。',
  missing:'SmartSub 已完成，但本地找不到可用的字幕文件。可以重试转写。',
};
export interface SmartSubTaskView {
  requestId:string;
  status:SmartSubTaskStatus;
  subtitleCount:number;
  hasSubtitles:boolean;
  transcriptionOutputIssue?:TranscriptionOutputIssue;
}
export interface SmartSubSource {document:SourceDocument;entryId:string}
export interface SmartSubReadiness {version:string;compatible:boolean;transcriptionCompatible:boolean;downloaders:string[]}
export type SmartSubTranscriptionReadiness={ready:true;engine:string;model:string}|{ready:false;reason:string};
export interface SmartSubSelection {engine:string;model:string}
export interface SmartSubPreferencesView {selection:SmartSubSelection|null;options:{id:string;ready:boolean;models:string[]}[];warning?:string}

export type VideoStage = 'queued'|'downloading'|'waiting-transcription'|'transcribing'|'blocked'|'ready'|'failed'|'cancelled';
export interface VideoQueueItem {
  id:string;
  label:string;
  stage:VideoStage;
  subtitleCount:number;
  message?:string;
  cancelRequested?:boolean;
  needsRecovery?:boolean;
}
export interface VideoQueueView { paused:boolean; items:VideoQueueItem[] }
export interface VideoSubtitlePreview { name:string; format:string; lines:string[] }
export type VideoQueueAction =
  | {type:'state'} | {type:'resume'}
  | {type:'add';links:string;autoTranscribe:boolean}
  | {type:'retry';id:string} | {type:'cancel'|'refresh'|'remove';id:string};
