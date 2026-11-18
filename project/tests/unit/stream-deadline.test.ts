import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamDeadline } from '../../src/modules/analysis/stream-deadline.ts';

test('effective text changes the waiting deadline to an idle deadline', async () => {
  const deadline = createStreamDeadline({firstOutputMs:60, idleMs:60, requestMs:500});
  deadline.text('  ');
  await new Promise(resolve => setTimeout(resolve, 30));
  deadline.text('first');
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(deadline.signal.aborted, false);
  deadline.text('next');
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(deadline.signal.aborted, false);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(deadline.reason(), 'STREAM_IDLE_TIMEOUT');
  deadline.dispose();
});

test('whitespace does not prevent the first output timeout', async () => {
  const deadline = createStreamDeadline({firstOutputMs:30, idleMs:30, requestMs:500});
  deadline.text(' \n');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(deadline.reason(), 'FIRST_OUTPUT_TIMEOUT');
  deadline.dispose();
});

test('the request deadline remains fixed while output arrives', async () => {
  const deadline = createStreamDeadline({firstOutputMs:200, idleMs:200, requestMs:50});
  deadline.text('first');
  await new Promise(resolve => setTimeout(resolve, 30));
  deadline.text('second');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(deadline.reason(), 'REQUEST_TIMEOUT');
  deadline.dispose();
});
