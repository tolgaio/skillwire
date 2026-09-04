import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { MouseProvider } from '../mouse.js';
import { List } from './List.js';

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function frameOf(cursor: number, items = ['alpha', 'beta', 'gamma']): Promise<string[]> {
  const app = render(
    <MouseProvider enabled={false}>
      {/* A panel far taller than the list, which is where the bug lived. */}
      <Box flexDirection="column" height={12} width={30} borderStyle="round">
        <List
          items={items}
          cursor={cursor}
          height={10}
          render={(item) => <Text>{item}</Text>}
        />
      </Box>
    </MouseProvider>,
  );
  await tick();
  const lines = (app.lastFrame() ?? '').split('\n');
  app.unmount();
  return lines;
}

test('every row is one line, however much room there is', async () => {
  // The highlighted row grew to fill the panel: flexGrow in a column grows
  // vertically, so the bar took every spare line instead of the width.
  const lines = await frameOf(0);
  const at = (needle: string): number => lines.findIndex((l) => l.includes(needle));
  assert.equal(at('beta') - at('alpha'), 1, lines.join('\n'));
  assert.equal(at('gamma') - at('beta'), 1, lines.join('\n'));
});

test('the row under the cursor is marked, wherever the cursor is', async () => {
  for (const cursor of [0, 1, 2]) {
    const lines = await frameOf(cursor);
    const marked = lines.filter((l) => l.includes('▸'));
    assert.equal(marked.length, 1, `cursor ${cursor}: ${lines.join('\n')}`);
    assert.match(marked[0]!, new RegExp(['alpha', 'beta', 'gamma'][cursor]!));
  }
});

test('the rows stay put as the cursor moves', async () => {
  const first = await frameOf(0);
  const last = await frameOf(2);
  const strip = (lines: string[]): string[] =>
    lines.map((l) => l.replace('▸', ' ')).filter((l) => /alpha|beta|gamma/.test(l));
  assert.deepEqual(strip(first), strip(last));
});

test('a list longer than the window is cut to it', async () => {
  const many = Array.from({ length: 40 }, (_, i) => `item-${String(i).padStart(2, '0')}`);
  const lines = await frameOf(0, many);
  assert.ok(lines.some((l) => l.includes('item-00')));
  assert.ok(!lines.some((l) => l.includes('item-30')), 'the window has to bound it');
});

test('the window reports where it sits, rather than drawing it', async () => {
  // Drawn by the list, the position was a row that appeared as soon as a list
  // outgrew its window — and every row above moved up to make space, so
  // opening a folder scrolled the list out from under the cursor.
  const { listWindow } = await import('./List.js');
  const many = Array.from({ length: 40 }, (_, i) => i);
  assert.deepEqual(
    (({ first, last, total }) => ({ first, last, total }))(listWindow(many, 0, 10)),
    { first: 1, last: 10, total: 40 },
  );
  assert.equal(listWindow(many, 39, 10).last, 40);
  assert.equal(listWindow([1, 2], 0, 10).total, 2, 'a short list still reports itself');
});

test('the two markers are the same width, so columns cannot drift', async () => {
  // The reason these are not emoji: a tick and a white square are two cells
  // wide, terminals disagree about whether they really are, and a marker whose
  // width is a matter of opinion pulls every column after it out of line.
  const { default: stringWidth } = await import('string-width');
  const { MARKS } = await import('./List.js');
  assert.equal(stringWidth(MARKS.on), stringWidth(MARKS.off), JSON.stringify(MARKS));
  assert.equal(stringWidth(MARKS.on), MARKS.on.length, 'and one cell per character');
});

test('a picked row and an unpicked one line up', async () => {
  const { Box, Text, renderToString } = await import('ink');
  const { Cell, Check, List, Rest, MARKS } = await import('./List.js');
  const { MouseProvider } = await import('../mouse.js');

  const out = await renderToString(
    <MouseProvider enabled={false}>
      <Box flexDirection="column" width={40}>
        <List
          items={[true, false]}
          cursor={0}
          height={4}
          render={(on, here) => (
            <>
              <Cell width={MARKS.on.length + 1}>
                <Check on={on} here={here} />
              </Cell>
              <Rest>
                <Text>name</Text>
              </Rest>
            </>
          )}
        />
      </Box>
    </MouseProvider>,
    { columns: 40 },
  );
  const columns = out
    .split('\n')
    .filter((l) => l.includes('name'))
    .map((l) => l.indexOf('name'));
  assert.equal(columns.length, 2);
  assert.equal(columns[0], columns[1], `the name column moved:\n${out}`);
});
