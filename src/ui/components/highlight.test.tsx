import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * The highlighted row has to stay readable in someone else's colour scheme.
 *
 * A terminal's palette belongs to the user, so the bar is grey and recolours
 * nothing: the green tick stays green, and every other colour on the row keeps
 * whatever meaning it had. What that leaves to check is the one thing grey
 * does break — dim text, which against a grey background stops being visible
 * at all.
 *
 * Colour has to be forced on, and chalk decides that when it loads, so ink is
 * imported after the environment is set. This file gets its own process.
 */
process.env.FORCE_COLOR = '3';

const ESC = String.fromCharCode(27);
const SGR = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g');

/** Characters drawn dim while the background is set. */
function dimOnBar(line: string): string {
  let dim = false;
  let bg = false;
  let found = '';
  let at = 0;
  SGR.lastIndex = 0;
  for (let m = SGR.exec(line); ; m = SGR.exec(line)) {
    const text = line.slice(at, m ? m.index : undefined);
    if (bg && dim) found += text.trim();
    if (!m) break;
    at = SGR.lastIndex;
    for (const code of m[1]!.split(';')) {
      const n = Number(code || '0');
      // 2 dims, 22 undims; 40-47 and 100-107 set a background, 49 clears it.
      if (n === 0) {
        dim = false;
        bg = false;
      } else if (n === 2) dim = true;
      else if (n === 22) dim = false;
      else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) bg = true;
      else if (n === 49) bg = false;
    }
  }
  return found;
}

test('the scanner finds dim text on a bar', () => {
  // Guarding the guard: a bar with dim text in it must be caught.
  assert.equal(dimOnBar(`${ESC}[100mok ${ESC}[2mfaint${ESC}[22m${ESC}[49m`), 'faint');
  assert.equal(dimOnBar(`${ESC}[100mok solid${ESC}[49m`), '');
  assert.equal(dimOnBar(`${ESC}[2mfaint, but off the bar${ESC}[22m`), '');
});

test('nothing on the highlighted row is dim, and the tick keeps its colour', async () => {
  const { Box, Text, renderToString } = await import('ink');
  const { Check, Cell, List, Rest, rowColour } = await import('./List.js');
  const { MouseProvider } = await import('../mouse.js');

  const out = await renderToString(
    <MouseProvider enabled={false}>
      <Box flexDirection="column" width={60}>
        <List
          items={['alpha', 'beta']}
          cursor={0}
          height={4}
          render={(item, here) => (
            <>
              <Cell width={4}>
                <Check on here={here} />
              </Cell>
              <Cell width={12}>
                <Text bold={here} {...rowColour(here)}>
                  {item}
                </Text>
              </Cell>
              <Rest>
                <Text {...rowColour(here, true)}>a description</Text>
              </Rest>
            </>
          )}
        />
      </Box>
    </MouseProvider>,
    { columns: 60 },
  );

  const bar = out.split('\n').find((l) => l.includes('▸'));
  assert.ok(bar, `no highlighted row in:\n${out}`);
  assert.match(bar, /\[100m/, 'the bar is drawn in grey');
  assert.equal(dimOnBar(bar), '', `this goes invisible against the bar: ${bar}`);
  assert.match(bar, /\[32m\[x\]/, 'the tick is still green, not repainted to fit the bar');
});

test('the bar colour can be overridden for a terminal this guess does not suit', async () => {
  const before = process.env.SKILLWIRE_HIGHLIGHT;
  process.env.SKILLWIRE_HIGHLIGHT = 'magenta';
  try {
    const { HIGHLIGHT } = await import(`./List.js?v=${Date.now()}`);
    assert.equal(HIGHLIGHT, 'magenta');
  } finally {
    if (before === undefined) delete process.env.SKILLWIRE_HIGHLIGHT;
    else process.env.SKILLWIRE_HIGHLIGHT = before;
  }
});
