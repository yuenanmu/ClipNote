import type { SavedRevision } from './storage.ts';
export interface WorkflowState { status: 'idle' | 'running' | 'saving' | 'succeeded' | 'failed' | 'cancelled'; completedChunks: number; sourceId?: string; revision?: SavedRevision; error?: { code: string; message: string }; canRetrySave?: boolean; timing?: { prepareMs: number; apiMs: number; localMs: number; saveMs: number; requests: number } }
export type WorkflowResult = { status: 'ok'; value: WorkflowState } | { status: 'error'; error: { code: string; message: string } };
