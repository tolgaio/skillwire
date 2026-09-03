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

test('a list longer than the window is cut to it, and says so', async () => {
  const many = Array.from({ length: 40 }, (_, i) => `item-${String(i).padStart(2, '0')}`);
  const lines = await frameOf(0, many);
  assert.ok(lines.some((l) => l.includes('item-00')));
  assert.ok(!lines.some((l) => l.includes('item-30')), 'the window has to bound it');
  assert.ok(lines.some((l) => /of 40/.test(l)));
});
