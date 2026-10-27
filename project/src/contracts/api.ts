export interface ApiConfigInput { baseUrl: string; model: string; contextWindow: number; maxTokens: number; apiKey: string }
export type ApiState = { configured: false } | { configured: true; baseUrl: string; model: string; contextWindow: number; maxTokens: number };
export type ApiErrorCode = 'INVALID_CONFIG' | 'KEY_REQUIRED' | 'ENCRYPTION_UNAVAILABLE' | 'CONFIG_DAMAGED' | 'CONFIG_FAILED' | 'FORBIDDEN_REQUEST' | 'BUSY' | 'AUTH_FAILED' | 'PERMISSION_DENIED' | 'QUOTA' | 'BALANCE' | 'RATE_LIMIT' | 'NETWORK' | 'CANCELLED' | 'TRUNCATED' | 'INVALID_RESPONSE';
export type ApiResult<T> = { status: 'ok'; value: T } | { status: 'error'; error: { code: ApiErrorCode; message: string } };
