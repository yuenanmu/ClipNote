import { randomUUID } from 'node:crypto';
import type {DiagnosticPhase,DiagnosticTerminal,DiagnosticEvent,OrganizationTaskSnapshot} from '../contracts/organization-task.ts';
export type {DiagnosticPhase} from '../contracts/organization-task.ts';

type Terminal = DiagnosticTerminal;
type Snapshot = OrganizationTaskSnapshot;
const phases = new Set<DiagnosticPhase>(['preparing', 'request', 'headers', 'first_text', 'last_text', 'received', 'validating', 'staging', 'awaiting_save', 'saving', 'saved']);
const errors = new Set(['network', 'timeout', 'first_output_timeout', 'stream_idle_timeout', 'request_timeout', 'file_timeout', 'authentication', 'permission', 'rate_limit', 'invalid_response', 'validation', 'saving', 'unknown']);
const maxEvents = 128;
export function classifyDiagnosticError(error:unknown):string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as {code?:unknown}).code : undefined;
  switch (code) {
    case 'TIMEOUT': return 'timeout';
    case 'FIRST_OUTPUT_TIMEOUT': return 'first_output_timeout';
    case 'STREAM_IDLE_TIMEOUT': return 'stream_idle_timeout';
    case 'REQUEST_TIMEOUT': return 'request_timeout';
    case 'FILE_TIMEOUT': return 'file_timeout';
    case 'NETWORK': case 'SERVER_ERROR': case 'network_error': case 'stream_interrupted': return 'network';
    case 'AUTH_FAILED': case 'sign_in_required': return 'authentication';
    case 'PERMISSION_DENIED': case 'sharing_not_enabled': case 'subscription_sharing_user_not_eligible': return 'permission';
    case 'RATE_LIMIT': case 'BALANCE': case 'subscription_sharing_usage_limit_exceeded': return 'rate_limit';
    case 'INVALID_RESPONSE': case 'invalid_stream': case 'response_incomplete': return 'invalid_response';
    case 'INVALID_REFERENCE': case 'INVALID_STRUCTURE': case 'INVALID_CHECKPOINT': return 'validation';
    default: {
      const status = typeof error === 'object' && error !== null && 'status' in error ? (error as {status?:unknown}).status : undefined;
      if (typeof status === 'number') {
        if (status === 401) return 'authentication';
        if (status === 403) return 'permission';
        if (status === 429 || status === 402) return 'rate_limit';
        if (status === 408) return 'timeout';
        if (status >= 500 && status <= 599) return 'network';
      }
      return 'unknown';
    }
  }
}

/** In-memory, content-free diagnostic records owned by the main process. */
export function createOrganizationTasks(clock: () => number = () => performance.now()) {
  const records = new Map<string, { start: number; snapshot: Snapshot }>();
  const pending = new Map<string, string>();
  const append = (record: {start:number;snapshot:Snapshot}, phase: DiagnosticEvent['phase'], ageMs=0) => {
    record.snapshot.revision++;
    const previous = record.snapshot.events.at(-1);
    if (phase === 'last_text' && previous?.phase === 'last_text') {
      previous.elapsedMs = Math.max(0, clock() - record.start - ageMs);
      return;
    }
    if (record.snapshot.events.length >= maxEvents - 1) record.snapshot.events.splice(1, 1);
    record.snapshot.events.push({phase,elapsedMs:Math.max(0,clock()-record.start-ageMs)});
  };
  return {
    start(service: Snapshot['service'], sourceId?:string): string {
      while (records.size >= 256) {
        const entries = [...records.entries()];
        const candidate = entries.find(([, value]) => !['running', 'awaiting_save'].includes(value.snapshot.status))
          ?? entries.find(([, value]) => value.snapshot.status === 'awaiting_save');
        if (!candidate) break;
        records.delete(candidate[0]);
        for (const [resultId, taskId] of pending) if (taskId === candidate[0]) pending.delete(resultId);
      }
      const id = randomUUID();
      records.set(id, { start: clock(), snapshot: { id, ...(sourceId && (/^[0-9a-f-]{36}$/i.test(sourceId) || /^[a-f0-9]{64}$/.test(sourceId)) ? {sourceId} : {}), revision:0, requests:0, service, status: 'running', events: [{ phase: 'preparing', elapsedMs: 0 }] } });
      return id;
    },
    event(id: string, event: { phase: DiagnosticPhase; ageMs?:number }): void {
      const record = records.get(id);
      if (!record || record.snapshot.status !== 'running' || !phases.has(event.phase)) return;
      if (event.phase==='request') record.snapshot.requests++;
      append(record,event.phase,typeof event.ageMs==='number' && Number.isFinite(event.ageMs) ? Math.max(0,Math.min(event.ageMs,1000)) : 0);
    },
    progress(id:string, value:{requests:number;chunkIndex:number;totalChunks?:number}):void {
      const record=records.get(id);
      if (!record || record.snapshot.status!=='running' || !Number.isInteger(value.chunkIndex) || value.chunkIndex<0 || !Number.isInteger(value.requests) || value.requests<0) return;
      const total=value.totalChunks;
      record.snapshot.chunk={index:value.chunkIndex,...(Number.isInteger(total) && total!>0 && value.chunkIndex<total! ? {total}: {})};
      record.snapshot.revision++;
    },
    finish(id: string, status: Terminal, error?: string): void {
      const record = records.get(id);
      if (!record || record.snapshot.status !== 'running') return;
      record.snapshot.status = status;
      if (error) record.snapshot.error = errors.has(error) ? error : 'unknown';
      append(record,status);
    },
    pending(id:string,resultId:string):void {
      const record=records.get(id);
      if (!record || record.snapshot.status!=='running') return;
      pending.set(resultId,id);append(record,'awaiting_save');record.snapshot.status='awaiting_save';
    },
    saveStarted(resultId:string):void {
      const record=records.get(pending.get(resultId) ?? '');
      if (record?.snapshot.status==='awaiting_save') append(record,'saving');
    },
    saveFailed(resultId:string):void {
      const record=records.get(pending.get(resultId) ?? '');
      if (record?.snapshot.status==='awaiting_save') { record.snapshot.error='saving'; append(record,'awaiting_save'); }
    },
    saveFinished(resultId:string):void {
      const id=pending.get(resultId);const record=records.get(id ?? '');
      if (!record || record.snapshot.status!=='awaiting_save') return;
      append(record,'saved');delete record.snapshot.error;record.snapshot.status='succeeded';append(record,'succeeded');pending.delete(resultId);
    },
    get(id: string): Snapshot | undefined {
      const record = records.get(id);
      return record ? structuredClone(record.snapshot) : undefined;
    },
    list(): Snapshot[] {
      return Array.from(records.values(), record => structuredClone(record.snapshot));
    },
  };
}
