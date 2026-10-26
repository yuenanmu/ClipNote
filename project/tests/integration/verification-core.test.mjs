import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supportsPiRuntime, readApiConfig, findSmartSub, failureSummary, requireTextResult } from '../../tools/verification-core.mjs';

const artifacts = fileURLToPath(new URL('../../../.local/test-artifacts/', import.meta.url));
function fixture(t) {
  mkdirSync(artifacts, { recursive: true });
  const path = mkdtempSync(join(artifacts, 'probe-'));
  t.after(() => {
    assert.equal(resolve(dirname(path)), resolve(artifacts));
    assert.ok(basename(path).startsWith('probe-'));
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}

test('accepts the SDK Node floor and newer embedded runtimes', () => {
  assert.equal(supportsPiRuntime('22.19.0'), true);
  assert.equal(supportsPiRuntime('v24.22.0'), true);
});
test('rejects older or unknown runtime versions', () => {
  assert.equal(supportsPiRuntime('22.18.9'), false);
  assert.equal(supportsPiRuntime('20.19.0'), false);
  assert.equal(supportsPiRuntime('unknown'), false);
});
test('requires explicit API credentials and model without exposing values', () => {
  assert.throws(() => readApiConfig({}), /CLIPNOTE_API_KEY/);
  assert.throws(() => readApiConfig({ CLIPNOTE_API_KEY: 'secret-value' }), /CLIPNOTE_MODEL/);
});
test('retains the explicitly selected API endpoint and model', () => {
  const config = readApiConfig({ CLIPNOTE_API_KEY: 'test-key', CLIPNOTE_MODEL: 'chosen-model', CLIPNOTE_API_BASE_URL: 'https://example.invalid/v1' });
  assert.equal(config.model, 'chosen-model');
  assert.equal(config.baseUrl, 'https://example.invalid/v1');
  assert.equal(config.apiKey, 'test-key');
});
test('rejects embedded URL credentials without echoing them', () => {
  assert.throws(() => readApiConfig({ CLIPNOTE_API_KEY: 'key', CLIPNOTE_MODEL: 'm', CLIPNOTE_API_BASE_URL: 'https://name:private-password@example.invalid/v1' }), error => !error.message.includes('private-password') && error.code === 'INVALID_CONFIG');
});
test('detects a complete SmartSub installation in a path with spaces and Chinese', t => {
  const root = join(fixture(t), '字幕 工具');
  mkdirSync(join(root, 'resources', 'automation'), { recursive: true });
  writeFileSync(join(root, 'SmartSub.exe'), 'synthetic fixture');
  writeFileSync(join(root, 'resources', 'automation', 'cli.cjs'), 'synthetic fixture');
  assert.deepEqual(findSmartSub([root]), { appPath: join(root, 'SmartSub.exe'), cliPath: join(root, 'resources', 'automation', 'cli.cjs') });
});
test('does not treat a partial or missing installation as CLI ready', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'SmartSub.exe'), 'synthetic fixture');
  assert.equal(findSmartSub([join(root, 'missing'), root]), null);
});
test('failure summaries never include request bodies or raw credential errors', () => {
  const result = failureSummary({ status: 401, message: 'Bearer secret-value', body: { apiKey: 'secret-value' } });
  assert.equal(result.status, 'failed');
  assert.equal(result.httpStatus, 401);
  assert.equal(JSON.stringify(result).includes('secret-value'), false);
});

test('only accepts a completed response containing actual text', () => {
  assert.equal(requireTextResult({ stopReason: 'stop', content: [{ type: 'text', text: 'ClipNote OK' }] }), 'ClipNote OK');
});
test('rejects failed or cancelled streams even if they contain partial text', () => {
  for (const stopReason of ['error', 'aborted', 'length']) {
    assert.throws(() => requireTextResult({ stopReason, content: [{ type: 'text', text: 'partial' }] }), /REQUEST_INCOMPLETE/);
  }
});
test('does not call an empty response a successful inference', () => {
  assert.throws(() => requireTextResult({ stopReason: 'stop', content: [] }), /EMPTY_RESPONSE/);
});

test('requires an explicit destination so a generic key is not sent to a default service', () => {
  assert.throws(() => readApiConfig({ CLIPNOTE_API_KEY: 'key', CLIPNOTE_MODEL: 'm' }), /CLIPNOTE_API_BASE_URL/);
});

test('reports known local failures with fixed non-secret categories', () => {
  assert.equal(failureSummary(new Error('RUNTIME_UNSUPPORTED')).category, 'runtime-unsupported');
  assert.equal(failureSummary(Object.assign(new Error('do not echo'), { code: 'INVALID_CONFIG' })).category, 'invalid-configuration');
  assert.equal(failureSummary(new Error('ENCRYPTION_UNAVAILABLE')).category, 'encryption-unavailable');
});
test('distinguishes cancelled and truncated output without returning partial content', () => {
  for (const [stopReason, expected] of [['aborted', 'cancelled'], ['length', 'truncated']]) {
    let error;
    try { requireTextResult({ stopReason, content: [{ type: 'text', text: 'private partial text' }] }); } catch (failure) { error = failure; }
    const summary = failureSummary(error);
    assert.equal(summary.category, expected);
    assert.equal(JSON.stringify(summary).includes('private'), false);
  }
});
test('preserves only recognized subscription failure codes', () => {
  let error;
  try { requireTextResult({ stopReason: 'error', errorMessage: 'subscription_sharing_user_not_eligible; secret-value' }); } catch (failure) { error = failure; }
  const summary = failureSummary(error);
  assert.equal(summary.category, 'account-not-eligible');
  assert.equal(JSON.stringify(summary).includes('secret-value'), false);
});
