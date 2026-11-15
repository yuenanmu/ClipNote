import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceHandler } from '../../src/main/workspace-controller.ts';

test('workspace IPC refuses untrusted and path-bearing requests before performing actions', async () => {
  let calls = 0; const handle = createWorkspaceHandler({ isTrustedSender: (event: unknown) => event === 'trusted', execute: async () => { calls++; return {}; } });
  assert.equal((await handle('untrusted', 'source', 'root')).status, 'error');
  assert.equal((await handle('trusted', 'source', 'choose', 'D:/private')).status, 'error');
  assert.equal((await handle('trusted', 'source', 'list', '../private')).status, 'error');
  assert.equal((await handle('trusted', 'other', 'root')).status, 'error'); assert.equal(calls, 0);
  assert.equal((await handle('trusted', 'source', 'root')).status, 'ok'); assert.equal(calls, 1);
});
