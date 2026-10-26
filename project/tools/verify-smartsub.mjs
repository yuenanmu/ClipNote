import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { findSmartSub, failureSummary } from './verification-core.mjs';

const roots = [process.env.CLIPNOTE_SMARTSUB_DIR, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'SmartSub'), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'SmartSub'), process.env.ProgramFiles && join(process.env.ProgramFiles, 'SmartSub')];
try {
  const install = findSmartSub(roots);
  if (!install) {
    console.log(JSON.stringify({ status: 'not-run', reason: 'smartsub-not-detected', next: 'Install SmartSub or set CLIPNOTE_SMARTSUB_DIR to its installation folder.' }));
    process.exitCode = 2;
  } else {
    const result = spawnSync(install.appPath, [install.cliPath, '--help'], { shell: false, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SMARTSUB_APP_PATH: install.appPath } });
    if (result.error || result.status !== 0 || !result.stdout?.trim()) throw new Error('CLI_HELP_FAILED');
    console.log(JSON.stringify({ status: 'passed', scope: 'real-cli-help-only', actualTranscriptionRun: false }));
  }
} catch (error) {
  console.error(JSON.stringify(failureSummary(error)));
  process.exitCode = 1;
}
