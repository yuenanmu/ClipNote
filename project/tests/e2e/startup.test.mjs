import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const helper = fileURLToPath(new URL('../helpers/native-window.ps1', import.meta.url));
const project = fileURLToPath(new URL('../../', import.meta.url));

test('npm start displays a native window and system controls close the whole launcher', { skip: process.platform !== 'win32', timeout: 90_000 }, async t => {
  const launcher = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd start'], { cwd: project, env: { ...process.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', exited = false;
  for (const stream of [launcher.stdout, launcher.stderr]) stream.on('data', part => { output = (output + part).slice(-4096); });
  const exit = new Promise((resolve, reject) => { launcher.once('error', reject); launcher.once('exit', code => { exited = true; resolve(code); }); });
  void exit.catch(() => {});
  const native = async (action, extra = []) => {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-File', helper, '-ParentProcessId', String(launcher.pid), '-Action', action, ...extra], { windowsHide: true, encoding: 'utf8', timeout: 25_000 });
    return JSON.parse(stdout.trim());
  };
  t.after(async () => {
    if (exited) return;
    await native('Close').catch(() => {});
    await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 1500))]);
    if (!exited) await execute('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  });

  const initial = await native('Inspect', ['-WaitVisible']);
  assert.equal(initial.Visible, true, 'npm start must show the real native window, not only render a CDP screenshot');
  assert.equal(initial.Enabled, true);
  assert.equal(initial.Hung, false);
  const restored = await native('Restore');
  assert.equal(restored.Minimized, false);
  const maximized = await native('Maximize');
  assert.equal(maximized.Maximized, true, 'system maximize must work');
  assert.equal(maximized.Minimized, false);
  const normal = await native('Restore');
  assert.equal(normal.Maximized, false, 'system restore must leave maximized state');
  const minimized = await native('Minimize');
  assert.equal(minimized.Minimized, true, 'system minimize must work');
  const screenshot = fileURLToPath(new URL('../../../.local/test-artifacts/npm-start-native.png', import.meta.url));
  const finalWindow = await native('Restore', ['-ScreenshotPath', screenshot]);
  assert.equal(finalWindow.Minimized, false);
  assert.equal(finalWindow.CaptureSaved, true);
  await native('Close');
  const timeout = new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('System close must exit without Ctrl+C: ' + output)), 10_000); timer.unref(); });
  assert.equal(await Promise.race([exit, timeout]), 0);
});
