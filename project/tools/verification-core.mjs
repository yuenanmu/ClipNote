import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function supportsPiRuntime(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '');
  if (!match) return false;
  const [major, minor] = match.slice(1).map(Number);
  return major > 22 || (major === 22 && minor >= 19);
}

export function readApiConfig(env) {
  const required = name => {
    const value = env[name]?.trim();
    if (!value) throw Object.assign(new Error(`需要配置 ${name}`), { code: 'CONFIG_REQUIRED' });
    return value;
  };
  const apiKey = required('CLIPNOTE_API_KEY');
  const model = required('CLIPNOTE_MODEL');
  const baseUrl = required('CLIPNOTE_API_BASE_URL');
  let url;
  try { url = new URL(baseUrl); } catch { /* Report only the configuration field. */ }
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Object.assign(new Error('CLIPNOTE_API_BASE_URL 配置无效'), { code: 'INVALID_CONFIG' });
  }
  return { apiKey, model, baseUrl };
}

export function findSmartSub(roots) {
  for (const root of roots) {
    if (!root) continue;
    const appPath = resolve(root, 'SmartSub.exe');
    const cliPath = join(resolve(root), 'resources', 'automation', 'cli.cjs');
    try {
      if (statSync(appPath).isFile() && statSync(cliPath).isFile()) return { appPath, cliPath };
    } catch { /* A missing candidate is not an installed program. */ }
  }
  return null;
}

const failureCategories = Object.freeze({
  CONFIG_REQUIRED: 'configuration-required',
  INVALID_CONFIG: 'invalid-configuration',
  RUNTIME_UNSUPPORTED: 'runtime-unsupported',
  ENCRYPTION_UNAVAILABLE: 'encryption-unavailable',
  ENCRYPTION_ROUNDTRIP_FAILED: 'encryption-failed',
  SDK_CONTRACT_MISSING: 'sdk-contract-missing',
  SUBSCRIPTION_AUTH_MISSING: 'authentication-failed',
  NO_ACCOUNT_MODEL_IN_SDK_CATALOG: 'model-unavailable',
  LOGIN_CANCELLED: 'cancelled',
  REQUEST_ABORTED: 'cancelled',
  RESPONSE_TRUNCATED: 'truncated',
  EMPTY_RESPONSE: 'empty-response',
  CLI_HELP_FAILED: 'smartsub-cli-failed',
  subscription_sharing_user_not_eligible: 'account-not-eligible',
  subscription_sharing_usage_limit_exceeded: 'usage-limit-exceeded',
  subscription_sharing_usage_unavailable: 'service-unavailable',
  subscription_sharing_unsupported_capability: 'unsupported-capability',
});

export function failureSummary(error, observedHttpStatus) {
  const httpStatus = observedHttpStatus ?? error?.status;
  const httpCategories = { 401: 'authentication-failed', 403: 'permission-denied', 429: 'usage-limit-exceeded', 503: 'service-unavailable' };
  const knownCode = [error?.code, error?.message].find(code => Object.hasOwn(failureCategories, code));
  const category = knownCode ? failureCategories[knownCode] : httpCategories[httpStatus] ?? (['AbortError', 'TimeoutError'].includes(error?.name) ? 'cancelled' : 'request-failed');
  const result = { status: 'failed', category };
  if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) result.httpStatus = httpStatus;
  return result;
}

export function requireTextResult(response) {
  if (response?.stopReason !== 'stop') {
    const reportedCode = Object.keys(failureCategories).filter(code => code.startsWith('subscription_')).find(code => response?.errorMessage?.includes(code));
    const code = reportedCode ?? (response?.stopReason === 'aborted' ? 'REQUEST_ABORTED' : response?.stopReason === 'length' ? 'RESPONSE_TRUNCATED' : 'REQUEST_INCOMPLETE');
    throw Object.assign(new Error('REQUEST_INCOMPLETE'), { code });
  }
  const text = (response.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('').trim();
  if (!text) throw Object.assign(new Error('EMPTY_RESPONSE'), { code: 'EMPTY_RESPONSE' });
  return text;
}
