import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const login = process.argv.includes('--login');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, [fileURLToPath(new URL('./electron-probe.mjs', import.meta.url)), ...(login ? ['--login'] : [])], { env, shell: false, windowsHide: true, stdio: 'inherit', timeout: login ? 360000 : 60000 });
child.on('error', () => { console.error(JSON.stringify({ status: 'failed', reason: 'electron-launch-failed' })); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
