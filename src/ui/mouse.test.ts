import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISABLE, ENABLE, parseMouse } from './mouse.js';

const ESC = String.fromCharCode(27);
// Ink hands the report over with the escape already eaten.
const report = (button: number, col: number, row: number, end = 'M') =>
  `[<${button};${col};${row}${end}`;

test('a left click is a press, then a release, at a 0-based cell', () => {
  assert.deepEqual(parseMouse(report(0, 12, 5)), {
    button: 0,
    column: 11,
    row: 4,
    kind: 'press',
  });
  assert.equal(parseMouse(report(0, 12, 5, 'm'))!.kind, 'release');
});

test('the wheel is reported as its own kind, not as a button', () => {
  assert.equal(parseMouse(report(64, 1, 1))!.kind, 'wheelUp');
  assert.equal(parseMouse(report(65, 1, 1))!.kind, 'wheelDown');
});

test('modifier bits do not change which button was pressed', () => {
  // shift/meta/ctrl are bits 2, 3 and 4 on top of the button number.
  assert.equal(parseMouse(report(4, 1, 1))!.button, 0, 'shift + left is still left');
  assert.equal(parseMouse(report(16, 1, 1))!.button, 0, 'ctrl + left is still left');
});

test('far-off columns survive, which is the whole point of the SGR encoding', () => {
  // The older encoding capped at 223; a wide terminal needs this one.
  assert.equal(parseMouse(report(0, 400, 90))!.column, 399);
});

test('anything that is not a mouse report is left alone', () => {
  for (const input of ['a', '?', '[A', '[<0;1;1', '[<a;1;1M', '', 'q']) {
    assert.equal(parseMouse(input), null, JSON.stringify(input));
  }
});

test('tracking is turned off with the same modes it was turned on with', () => {
  // Left on, the terminal keeps sending escape sequences to whatever runs next.
  for (const mode of ['1000', '1006']) {
    assert.ok(ENABLE.includes(`${ESC}[?${mode}h`), mode);
    assert.ok(DISABLE.includes(`${ESC}[?${mode}l`), mode);
  }
});
