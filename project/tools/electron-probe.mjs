import { app, safeStorage, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createModels } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { supportsPiRuntime, failureSummary, requireTextResult } from './verification-core.mjs';

const local = fileURLToPath(new URL('../../.local/integration-validation/', import.meta.url));
mkdirSync(local, { recursive: true });
for (const [name, folder] of [['userData', 'electron-user-data'], ['logs', 'logs'], ['crashDumps', 'crash-dumps']]) {
  const path = join(local, folder);
  mkdirSync(path, { recursive: true });
  app.setPath(name, path);
}
app.setName('ClipNote T02');
app.disableHardwareAcceleration();
let stage = 'electron-runtime';
let observedHttpStatus;
app.whenReady().then(async () => {
try {
  if (!supportsPiRuntime(process.versions.node)) throw new Error('RUNTIME_UNSUPPORTED');
  const encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable();
  if (!encryptionAvailable) throw new Error('ENCRYPTION_UNAVAILABLE');
  const synthetic = 'ClipNote T02 synthetic value';
  const encrypted = await safeStorage.encryptStringAsync(synthetic);
  const decrypted = await safeStorage.decryptStringAsync(encrypted);
  if (decrypted.result !== synthetic) throw new Error('ENCRYPTION_ROUNDTRIP_FAILED');
  const models = createModels(); // T02 keeps credentials only in memory.
  const provider = openaiProvider();
  models.setProvider(provider);
  console.log(JSON.stringify({ status: 'passed', scope: 'real-electron-runtime', electron: process.versions.electron, node: process.versions.node, sdkLoaded: models.getModels('openai').length > 0, oauthExposed: Boolean(provider.auth.oauth), encryptionRoundtrip: true, actualRequestRun: false }));

  if (process.argv.includes('--login')) {
    stage = 'subscription-login';
    const hostPath = join(local, 'host-id.txt');
    if (!existsSync(hostPath)) writeFileSync(hostPath, randomUUID(), { flag: 'wx' });
    const deviceId = readFileSync(hostPath, 'utf8').trim();
    const signal = AbortSignal.timeout(300000);
    await models.login('openai', 'oauth', {
      signal,
      notify(event) {
        if (event.type === 'auth_url') {
          console.log(JSON.stringify({ status: 'waiting', action: 'complete-sign-in-in-browser' }));
          void shell.openExternal(event.url).catch(() => {});
        }
      },
      prompt(prompt) {
        return new Promise((_, reject) => {
          const pendingSignal = prompt.signal ?? signal;
          const cancel = () => reject(new Error('LOGIN_CANCELLED'));
          if (pendingSignal.aborted) cancel();
          else pendingSignal.addEventListener('abort', cancel, { once: true });
        });
      },
    }, { getDeviceId: () => deviceId, agentName: 'ClipNote' });
    stage = 'subscription-model-catalog';
    const resolved = await models.getAuth('openai');
    if (!resolved?.auth.apiKey) throw new Error('SUBSCRIPTION_AUTH_MISSING');
    const catalogResponse = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${resolved.auth.apiKey}` }, signal: AbortSignal.timeout(30000) });
    if (!catalogResponse.ok) throw Object.assign(new Error('MODEL_CATALOG_FAILED'), { status: catalogResponse.status });
    const catalog = await catalogResponse.json();
    const model = (catalog.models ?? []).filter(item => item.visibility === 'list').map(item => models.getModel('openai', item.slug)).find(Boolean);
    if (!model) throw new Error('NO_ACCOUNT_MODEL_IN_SDK_CATALOG');
    stage = 'subscription-inference';
    const response = await models.completeSimple(model, { messages: [{ role: 'user', content: 'Reply with only: ClipNote OK', timestamp: Date.now() }] }, { maxRetries: 0, signal: AbortSignal.timeout(60000), fetch: async (...args) => { const response = await fetch(...args); observedHttpStatus = response.status; return response; } });
    const text = requireTextResult(response);
    console.log(JSON.stringify({ status: 'passed', scope: 'real-subscription-text', model: model.id, responseCharacters: text.length, credentials: 'in-memory-only', persistenceAndRefreshVerified: false }));
    await models.logout('openai'); // Clears local memory; does not claim remote revocation.
  }
  app.exit(0);
} catch (error) {
  console.error(JSON.stringify({ ...failureSummary(error, observedHttpStatus), stage }));
  app.exit(1);
}
});
