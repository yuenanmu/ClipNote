import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// This is an interactive GUI process. Hiding its Windows startup also hides
// the native app window; the Electron CLI likewise launches with false.
const child = spawn(electronPath, [fileURLToPath(new URL('../dist/main/index.cjs', import.meta.url))], { env, shell: false, windowsHide: false, stdio: 'inherit' });
child.on('error', () => { console.error('ClipNote 未能启动，请先执行 npm.cmd run build。'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
