import assert from 'node:assert/strict';
import test from 'node:test';
import { GRID, contentXOf, elementHeight, nextFreeSlot, snap, tidyStack } from '../src/participantUi/arrange.js';

test('snap rounds onto the 8px grid (and honours a custom step)', () => {
  assert.equal(snap(0), 0);
  assert.equal(snap(5), 8);
  assert.equal(snap(16), 16);
  assert.equal(snap(23), 24);
  assert.equal(snap(11, 4), 12);
});

test('elementHeight prefers an explicit height and falls back to per-type estimates', () => {
  assert.equal(elementHeight({ type: 'Text', props: { variant: 'heading' } }), 48);
  assert.equal(elementHeight({ type: 'Text', props: { variant: 'body' } }), 26);
  assert.equal(elementHeight({ type: 'Button' }), 42);
  assert.equal(elementHeight({ type: 'Rectangle', props: { height: 200 } }), 200);
});

test('contentXOf reflects a Screen padding and is 0 for a free Layout', () => {
  assert.equal(contentXOf({ type: 'Screen', props: { padding: 32 } }), 32);
  assert.equal(contentXOf({ type: 'Screen', props: {} }), 32);
  assert.equal(contentXOf({ type: 'Layout', props: {} }), 0);
});

test('tidyStack lays children into a non-overlapping, grid-aligned column', () => {
  const children = [
    { id: 'h', type: 'Text', props: { variant: 'heading' } },
    { id: 'b', type: 'Button', props: {} },
    { id: 'i', type: 'Input', props: {} },
  ];
  const positions = tidyStack(children, { x: 24, startY: 32 });
  assert.equal(positions.length, 3);
  assert.ok(positions.every(position => position.x % GRID === 0 && position.y % GRID === 0), 'every row start is on the 8px grid');
  assert.equal(positions[0].y, 32);
  assert.equal(positions[0].x, 24);
  for (let index = 1; index < positions.length; index += 1) {
    const above = children[index - 1];
    assert.ok(positions[index].y >= positions[index - 1].y + elementHeight(above), 'rows never overlap');
  }
  assert.equal(positions[1].y, 96, 'heading (48) + gap 16 = 96');
});

test('nextFreeSlot returns a grid slot below the tallest existing child', () => {
  const placed = [
    { id: 'a', type: 'Button', props: { y: 0 } },
    { id: 'b', type: 'Text', props: { variant: 'body', y: 80 } },
  ];
  const slot = nextFreeSlot(placed, { x: 24, first: 0 });
  assert.equal(slot.x, 24);
  assert.equal(slot.y, 120); // max(42, 80+26=106) + 16 = 122 → snapped to 120
});
