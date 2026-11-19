export type SmartSubDiscovery = {installed:false}|{installed:true;path:string};
import type {SourceDocument} from './source.ts';
import type {SmartSubTaskStatus} from '../modules/smartsub/receipts.ts';
export interface SmartSubTaskView {requestId:string;status:SmartSubTaskStatus;subtitleCount:number;hasSubtitles:boolean}
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
