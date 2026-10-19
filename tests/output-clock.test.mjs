import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { audioOutputTime } = await loadTs('../src/audio/outputClock.ts');

test('output timestamps account for wireless buffering without counting latency twice', () => {
  const context = { state: 'running', currentTime: 20, baseLatency: .02, outputLatency: 2,
    getOutputTimestamp: () => ({ contextTime: 17.5, performanceTime: 9900 }) };
  assert.equal(audioOutputTime(context, 10000), 17.6);
  context.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 9900 });
  assert.ok(Math.abs(audioOutputTime(context, 10000) - .1) < 1e-9, 'zero context time is valid during output startup');
  context.getOutputTimestamp = () => ({ contextTime: 30, performanceTime: 9900 });
  assert.equal(audioOutputTime(context, 10000), 20, 'presentation never leads rendered audio');
});

test('missing, uninitialized, invalid and throwing timestamps fall back to reported latency', () => {
  const context = { state: 'running', currentTime: 20, baseLatency: .02, outputLatency: 2 };
  assert.equal(audioOutputTime(context, 10000), 17.98);
  for (const stamp of [{ contextTime: 0, performanceTime: 0 }, { contextTime: NaN, performanceTime: 9900 }, { contextTime: 17, performanceTime: 10001 }]) {
    context.getOutputTimestamp = () => stamp;
    assert.equal(audioOutputTime(context, 10000), 17.98);
  }
  context.getOutputTimestamp = () => { throw new Error('Output unavailable'); };
  assert.equal(audioOutputTime(context, 10000), 17.98);
  context.outputLatency = Infinity; context.baseLatency = -1;
  assert.equal(audioOutputTime(context, 10000), 20);
  context.outputLatency = 30;
  assert.equal(audioOutputTime(context, 10000), 0);
});

test('suspended or interrupted timestamps do not extrapolate during a long interruption', () => {
  const context = { state: 'interrupted', currentTime: 20, getOutputTimestamp: () => ({ contextTime: 18, performanceTime: 1000 }) };
  assert.equal(audioOutputTime(context, 9000), 18);
  context.state = 'suspended'; assert.equal(audioOutputTime(context, 19000), 18);
});
