import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

test('the Electron main-process probe reaches ready and loads pi-ai without hanging', () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electronPath, [fileURLToPath(new URL('../../tools/electron-probe.mjs', import.meta.url))], { env, shell: false, windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error?.code, undefined, 'Electron probe must finish before its timeout');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), '', 'Runtime verification should not use deprecated encryption APIs');
  const lines = result.stdout.split(/\r?\n/).filter(line => line.startsWith('{'));
  const report = lines.map(line => JSON.parse(line)).find(item => item.scope === 'real-electron-runtime');
  assert.equal(report?.status, 'passed');
  assert.equal(report.sdkLoaded, true);
  assert.equal(report.encryptionRoundtrip, true);
  assert.equal(report.actualRequestRun, false);
});
