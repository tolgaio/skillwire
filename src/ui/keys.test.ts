import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Key } from 'ink';
import { clampOffset, moveCursor, nav } from './keys.js';

const key = (over: Partial<Key> = {}): Key =>
  ({
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...over,
  }) as Key;

test('vim keys and arrows resolve to the same movement', () => {
  assert.equal(nav('k', key()), nav('', key({ upArrow: true })));
  assert.equal(nav('j', key()), nav('', key({ downArrow: true })));
  assert.equal(nav('h', key()), nav('', key({ leftArrow: true })));
  assert.equal(nav('l', key()), nav('', key({ rightArrow: true })));
  assert.equal(nav('g', key()), 'top');
  assert.equal(nav('G', key()), 'bottom');
  assert.equal(nav('d', key({ ctrl: true })), 'pageDown');
  assert.equal(nav('u', key({ ctrl: true })), 'pageUp');
});

test('command keys are not swallowed by the navigator', () => {
  // a, n, s, f, i and the rest have to reach the screen.
  for (const input of 'ansfivoxKD') assert.equal(nav(input, key()), null, input);
  assert.equal(nav(' ', key()), null);
  assert.equal(nav('', key({ return: true })), null);
  assert.equal(nav('', key({ escape: true })), null);
});

test('left and right are not distances, they are for the screen to read', () => {
  assert.equal(moveCursor('left', 3, 10, 5), null);
  assert.equal(moveCursor('right', 3, 10, 5), null);
  assert.equal(moveCursor('down', 3, 10, 5), 4);
  assert.equal(moveCursor('pageDown', 3, 10, 5), 8);
  assert.equal(moveCursor('bottom', 3, 10, 5), 9);
  assert.equal(moveCursor('top', 3, 10, 5), 0);
});

test('movement clamps to the ends of the list', () => {
  assert.equal(moveCursor('up', 0, 10, 5), 0);
  assert.equal(moveCursor('down', 9, 10, 5), 9);
  assert.equal(moveCursor('pageDown', 7, 10, 5), 9, 'a page near the end lands on the last row');
  assert.equal(moveCursor('down', 0, 0, 5), null, 'an empty list has nowhere to go');
});

test('a list that fits is not scrolled', () => {
  assert.equal(clampOffset(0, 0, 3, 10), 0);
  assert.equal(clampOffset(5, 2, 3, 10), 0, 'and an offset it does not need is dropped');
});

test('the window stays put while the cursor is inside it', () => {
  // Centred on the cursor, every row on screen moved whenever the list changed
  // length: opening a folder of two hundred scrolled everything above it out
  // from under the cursor.
  assert.equal(clampOffset(40, 45, 100, 10), 40);
  assert.equal(clampOffset(40, 49, 100, 10), 40, 'right up to the last visible row');
});

test('it moves only as far as it must to keep the cursor', () => {
  assert.equal(clampOffset(40, 50, 100, 10), 41, 'one past the bottom, one row down');
  assert.equal(clampOffset(40, 39, 100, 10), 39, 'one before the top, one row up');
  assert.equal(clampOffset(40, 90, 100, 10), 81, 'a jump takes it straight there');
});

test('the window stops at both ends rather than running off', () => {
  assert.equal(clampOffset(0, 0, 100, 10), 0);
  assert.equal(clampOffset(95, 99, 100, 10), 90);
  assert.equal(clampOffset(-5, 0, 100, 10), 0, 'and refuses a nonsense offset');
});
