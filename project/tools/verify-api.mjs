import { createModels, createProvider } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { readApiConfig, failureSummary, requireTextResult } from './verification-core.mjs';

let observedHttpStatus;
try {
  const { apiKey, model: id, baseUrl } = readApiConfig(process.env);
  const model = { id, name: id, api: 'openai-completions', provider: 'clipnote-probe', baseUrl, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 256 };
  const models = createModels();
  models.setProvider(createProvider({ id: 'clipnote-probe', name: 'ClipNote T02', baseUrl, auth: { apiKey: { name: 'Configured API', resolve: async () => ({ auth: { apiKey } }) } }, models: [model], api: openAICompletionsApi() }));
  const response = await models.completeSimple(models.getModel('clipnote-probe', id), { messages: [{ role: 'user', content: 'Reply with only: ClipNote OK', timestamp: Date.now() }] }, { maxTokens: 64, maxRetries: 0, signal: AbortSignal.timeout(60000), fetch: async (...args) => { const response = await fetch(...args); observedHttpStatus = response.status; return response; } });
  const text = requireTextResult(response);
  console.log(JSON.stringify({ status: 'passed', scope: 'api-text-request', model: id, responseCharacters: text.length }));
} catch (error) {
  if (error.code === 'CONFIG_REQUIRED') {
    console.error(JSON.stringify({ status: 'not-run', reason: 'api-configuration-required', fields: ['CLIPNOTE_API_KEY', 'CLIPNOTE_MODEL', 'CLIPNOTE_API_BASE_URL'] }));
    process.exitCode = 2;
  } else {
    console.error(JSON.stringify(failureSummary(error, observedHttpStatus)));
    process.exitCode = 1;
  }
}
