import { readFileSync } from 'node:fs';
import { createModels } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { supportsPiRuntime, failureSummary } from './verification-core.mjs';

try {
  if (!supportsPiRuntime(process.versions.node)) throw new Error('RUNTIME_UNSUPPORTED');
  const provider = openaiProvider();
  const models = createModels();
  models.setProvider(provider);
  const sdk = JSON.parse(readFileSync(new URL('../node_modules/@earendil-works/pi-ai/package.json', import.meta.url), 'utf8'));
  const report = { status: 'passed', scope: 'runtime-import-only', node: process.versions.node, sdk: sdk.version, apiKeyAuth: Boolean(provider.auth.apiKey), oauth: Boolean(provider.auth.oauth), staticModelCount: models.getModels('openai').length, actualRequestRun: false };
  if (!report.apiKeyAuth || !report.oauth || report.staticModelCount === 0) throw new Error('SDK_CONTRACT_MISSING');
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(JSON.stringify(failureSummary(error)));
  process.exitCode = 1;
}
