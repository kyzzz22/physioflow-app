import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlockOrder, createJitteredDuration } from '../src/core/index.js';

test('fixed block order keeps item order', () => {
  const result = createBlockOrder({ items: ['a', 'b', 'c'], rule: 'fixed' });
  assert.deepEqual(result.order, ['a', 'b', 'c']);
});

test('random block order is seeded and deterministic', () => {
  const one = createBlockOrder({ items: ['a', 'b', 'c', 'd', 'e'], rule: 'random', seed: 7 });
  const two = createBlockOrder({ items: ['a', 'b', 'c', 'd', 'e'], rule: 'random', seed: 7 });
  assert.deepEqual(one.order, two.order);
  assert.deepEqual(one.order.sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.notDeepEqual(createBlockOrder({ items: ['a', 'b', 'c', 'd', 'e'], rule: 'random', seed: 7 }).order, createBlockOrder({ items: ['a', 'b', 'c', 'd', 'e'], rule: 'random', seed: 8 }).order);
});

test('latin square block order rotates deterministically by seed row', () => {
  const result = createBlockOrder({ items: ['a', 'b', 'c', 'd'], rule: 'latin_square', seed: 1 });
  assert.deepEqual(result.order, ['b', 'c', 'd', 'a']);
  assert.deepEqual(new Set(result.order), new Set(['a', 'b', 'c', 'd']));
});

test('manual block order preserves the given sequence and appends missing items', () => {
  const result = createBlockOrder({ items: ['a', 'b', 'c', 'd'], rule: 'manual', manualOrder: ['c', 'a'] });
  assert.deepEqual(result.order, ['c', 'a', 'b', 'd']);
});

test('no_immediate_repeat constraint breaks consecutive duplicates', () => {
  const result = createBlockOrder({ items: ['a', 'b'], rule: 'fixed', noImmediateRepeat: true, seed: 3 });
  for (let i = 1; i < result.order.length; i++) assert.notEqual(result.order[i], result.order[i - 1], `position ${i} repeats`);
});

test('jittered duration is deterministic and respects the distribution', () => {
  const one = createJitteredDuration({ baseMs: 1000, jitterMs: 200, distribution: 'uniform', seed: 5 });
  const two = createJitteredDuration({ baseMs: 1000, jitterMs: 200, distribution: 'uniform', seed: 5 });
  assert.equal(one.durationMs, two.durationMs);
  assert.ok(one.durationMs >= 800 && one.durationMs <= 1200);
  assert.equal(createJitteredDuration({ baseMs: 1000, distribution: 'fixed' }).deltaMs, 0);
  assert.equal(createJitteredDuration({ baseMs: 500, jitterMs: 1000, distribution: 'exponential', seed: 1 }).durationMs >= 0, true);
});
