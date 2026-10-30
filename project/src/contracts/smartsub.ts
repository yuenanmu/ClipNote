export type SmartSubDiscovery = {installed:false}|{installed:true;path:string};
import type {SourceDocument} from './source.ts';
import type {SmartSubTaskStatus} from '../modules/smartsub/receipts.ts';
export interface SmartSubTaskView {requestId:string;status:SmartSubTaskStatus;subtitleCount:number;hasSubtitles:boolean}
export interface SmartSubSource {document:SourceDocument;entryId:string}
export interface SmartSubReadiness {version:string;compatible:boolean;transcriptionCompatible:boolean;downloaders:string[]}
export type SmartSubTranscriptionReadiness={ready:true;engine:string;model:string}|{ready:false;reason:string};
export interface SmartSubSelection {engine:string;model:string}
export interface SmartSubPreferencesView {selection:SmartSubSelection|null;options:{id:string;ready:boolean;models:string[]}[];warning?:string}
