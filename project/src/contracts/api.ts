export interface ApiConfigInput { baseUrl: string; model: string; contextWindow: number; maxTokens: number; apiKey: string }
export interface ApiProfileRef { id: string; revision: number }
export interface ApiProfileView extends Omit<ApiConfigInput, 'apiKey'>, ApiProfileRef { name: string }
export type ApiProfileInput = ApiConfigInput & { name: string } & (ApiProfileRef | { id?: never; revision?: never });
export interface ApiProfilesView { defaultId?: string; profiles: ApiProfileView[] }
export interface ApiModelsInput { baseUrl: string; apiKey: string; profile?: ApiProfileRef | null }
export type ApiState = { configured: false } | { configured: true; baseUrl: string; model: string; contextWindow: number; maxTokens: number };
export type ApiErrorCode = 'REQUEST_LIMIT' | 'INVALID_CONFIG' | 'KEY_REQUIRED' | 'ENCRYPTION_UNAVAILABLE' | 'CONFIG_DAMAGED' | 'CONFIG_FAILED' | 'FORBIDDEN_REQUEST' | 'BUSY' | 'AUTH_FAILED' | 'PERMISSION_DENIED' | 'QUOTA' | 'BALANCE' | 'RATE_LIMIT' | 'NETWORK' | 'TIMEOUT' | 'FIRST_OUTPUT_TIMEOUT' | 'STREAM_IDLE_TIMEOUT' | 'REQUEST_TIMEOUT' | 'FILE_TIMEOUT' | 'SERVER_ERROR' | 'CANCELLED' | 'TRUNCATED' | 'INVALID_RESPONSE';
export type ApiResult<T> = { status: 'ok'; value: T } | { status: 'error'; error: { code: ApiErrorCode; message: string } };
