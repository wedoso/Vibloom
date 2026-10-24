import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';
const { createShuffleBag, reconcileShuffleBag } = await loadTs('../src/domain/library.ts');
const stable = () => .999;

test('new songs join an exhausted shuffle cycle instead of being ignored', () => {
  assert.deepEqual(reconcileShuffleBag([], ['a'], ['a', 'b'], 'a', stable), ['b']);
  assert.deepEqual(reconcileShuffleBag(['b'], ['a', 'b'], ['a', 'b', 'c'], 'a', stable), ['b', 'c']);
});

test('queue removal and reordering preserve remaining shuffle order without replaying heard songs', () => {
  assert.deepEqual(reconcileShuffleBag(['c', 'b'], ['a', 'b', 'c', 'd'], ['d', 'b', 'a'], 'a', stable), ['b']);
  assert.deepEqual(reconcileShuffleBag([], ['a', 'b'], ['b', 'a'], 'b', stable), []);
  assert.deepEqual(reconcileShuffleBag(['b'], ['a', 'b'], [], 'a', stable), []);
});

test('manually selected songs are consumed and removed songs can be queued again', () => {
  assert.deepEqual(reconcileShuffleBag(['b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c'], 'c', stable), ['b']);
  assert.deepEqual(reconcileShuffleBag(['b'], ['a', 'b'], ['a', 'b', 'c'], 'a', stable), ['b', 'c']);
});

test('a shuffle cycle visits each other song once and does not mutate queue order', () => {
  const queue = ['a', 'b', 'c', 'd'];
  const bag = createShuffleBag(queue, 'b', () => .25);
  assert.equal(new Set(bag).size, 3);
  assert.deepEqual([...bag].sort(), ['a', 'c', 'd']);
  assert.deepEqual(queue, ['a', 'b', 'c', 'd']);
});
