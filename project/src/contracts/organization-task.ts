/** Content-free diagnostics exposed to the desktop renderer. */
export type DiagnosticPhase = 'preparing' | 'request' | 'headers' | 'first_text' | 'last_text' | 'received' | 'validating' | 'staging' | 'awaiting_save' | 'saving' | 'saved';
export type DiagnosticTerminal = 'succeeded' | 'failed' | 'cancelled';
export interface DiagnosticEvent { phase: DiagnosticPhase | DiagnosticTerminal; elapsedMs: number }
export interface OrganizationTaskSnapshot {
  id: string;
  sourceId?: string;
  revision: number;
  requests: number;
  chunk?: {index:number; total?:number};
  service: 'api' | 'subscription';
  status: 'running' | 'awaiting_save' | DiagnosticTerminal;
  events: DiagnosticEvent[];
  error?: string;
}
