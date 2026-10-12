import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateChecks, UPDATE_CHECK_INTERVAL } from '../desktop/updateChecks.mjs';
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fixture(t, enabled = true) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let now = 0, calls = 0, status = 'idle', action = async () => {};
  const errors = [];
  const checks = createUpdateChecks({ enabled, now: () => now, status: () => status, check: () => { calls++; return action(); }, onError: error => errors.push(error) });
  t.after(() => checks.stop());
  return { checks, errors, calls: () => calls, status: value => { status = value; }, action: value => { action = value; }, tick: async ms => { now += ms; t.mock.timers.tick(ms); await flush(); } };
}

test('installed app checks after startup and on due resume, throttles focus, and stops timers', async t => {
  const f = fixture(t);
  f.checks.start();
  await f.checks.request(true); assert.equal(f.calls(), 0, 'initial focus waits for startup grace');
  await f.tick(14999); assert.equal(f.calls(), 0);
  await f.tick(1); assert.equal(f.calls(), 1);
  await f.checks.request(true); assert.equal(f.calls(), 1, 'focus does not check again');
  await f.tick(UPDATE_CHECK_INTERVAL); assert.equal(f.calls(), 2);
  f.checks.stop();
  await f.tick(UPDATE_CHECK_INTERVAL); await f.checks.request(true);
  assert.equal(f.calls(), 2, 'no checks after shutdown');
});

test('manual requests share an automatic check and can retry after an offline failure', async t => {
  const f = fixture(t);
  let settle;
  f.action(() => new Promise(resolve => { settle = resolve; }));
  f.checks.start(); await f.tick(15000);
  const first = f.checks.request(), second = f.checks.request();
  assert.equal(first, second); assert.equal(f.calls(), 1);
  settle(); await first;
  const offline = new Error('Offline'); f.action(() => Promise.reject(offline));
  await f.checks.request(); assert.deepEqual(f.errors, [offline]);
  f.action(async () => {}); await f.checks.request(); assert.equal(f.calls(), 3);
});

test('automatic checks preserve available updates and manual checks preserve download/install state', async t => {
  const f = fixture(t); f.checks.start(); f.status('available');
  await f.tick(15000); assert.equal(f.calls(), 0);
  await f.checks.request(); assert.equal(f.calls(), 1, 'manual checking remains available');
  for (const state of ['downloading', 'downloaded']) {
    f.status(state); await f.tick(UPDATE_CHECK_INTERVAL); await f.checks.request();
    assert.equal(f.calls(), 1, `${state} survives check requests`);
  }
  f.status('current'); await f.checks.request(true); assert.equal(f.calls(), 2, 'due focus after sleep checks once');
});

test('development builds do not schedule or send release checks', async t => {
  const f = fixture(t, false); f.checks.start();
  await f.tick(UPDATE_CHECK_INTERVAL); await f.checks.request();
  assert.equal(f.calls(), 0);
});

test('late renderer subscriptions restore update state without overwriting new events or updating after disposal', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const { EventEmitter } = await import('node:events');
  const source = await readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  for (const scenario of ['snapshot', 'newer', 'disposed']) {
    const ipc = new EventEmitter(), bridges = {}, received = [];
    let resolve;
    ipc.invoke = () => new Promise(done => { resolve = done; });
    runInNewContext(source, { require: () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (name, value) => { bridges[name] = value; } } }) });
    const unsubscribe = bridges.vibloomUpdates.subscribe(state => received.push(state.status));
    if (scenario === 'newer') ipc.emit('updates:status', {}, { status: 'downloaded' });
    if (scenario === 'disposed') unsubscribe();
    resolve({ status: 'available' }); await flush();
    assert.deepEqual(received, scenario === 'snapshot' ? ['available'] : scenario === 'newer' ? ['downloaded'] : []);
    unsubscribe(); assert.equal(ipc.listenerCount('updates:status'), 0);
  }
});

test('manual checking resets the next automatic deadline instead of skipping an entire interval', async t => {
  const f = fixture(t); f.checks.start(); await f.tick(15000);
  await f.tick(UPDATE_CHECK_INTERVAL / 2); await f.checks.request(); assert.equal(f.calls(), 2);
  await f.tick(UPDATE_CHECK_INTERVAL / 2); assert.equal(f.calls(), 2, 'old deadline does not cause a duplicate request');
  await f.tick(UPDATE_CHECK_INTERVAL / 2); assert.equal(f.calls(), 3, 'next check is six hours after the manual request');
});
