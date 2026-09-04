import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box, renderToString } from 'ink';
import { Markdown } from './Markdown.js';

const render = async (text: string, lines = 30, width = 40): Promise<string> =>
  renderToString(
    <Box width={width + 4} flexDirection="column" height={lines + 2}>
      <Markdown text={text} width={width} lines={lines} />
    </Box>,
    { columns: width + 4 },
  );

test('a list keeps every one of its items', async () => {
  // Rows were shrinkable, so a block taller than the space had Yoga squeeze
  // items out of the middle — a file rendered with lines missing from it
  // rather than one cut short.
  const items = Array.from({ length: 8 }, (_, i) => `${i + 1}. item ${i + 1}`);
  const out = await render(['Intro.', '', ...items].join('\n'));
  for (const item of items) assert.match(out, new RegExp(`item ${item.split(' ')[2]}`), out);
});

test('headings lose their hashes and keep their weight', async () => {
  const out = await render('# Title\n\n## Section\n\nbody');
  assert.match(out, /Title/);
  assert.match(out, /Section/);
  assert.doesNotMatch(out, /#/);
});

test('a run of blank lines is one blank line', async () => {
  const out = await render('one\n\n\n\n\ntwo', 10);
  const between = out.split('\n');
  const first = between.findIndex((l) => l.includes('one'));
  const second = between.findIndex((l) => l.includes('two'));
  assert.equal(second - first, 2, `five blank lines became ${second - first - 1}:\n${out}`);
});

test('fenced code is shown without its fences', async () => {
  const out = await render('before\n\n```bash\nnpm test\n```\n\nafter');
  assert.match(out, /npm test/);
  assert.doesNotMatch(out, /```/);
});

test('inline markers are dropped rather than drawn', async () => {
  const out = await render('a **bold** word and `code`');
  assert.match(out, /bold/);
  assert.match(out, /code/);
  assert.doesNotMatch(out, /\*\*/);
  assert.doesNotMatch(out, /`/);
});

test('a long line is cut, not wrapped', async () => {
  const out = await render('x'.repeat(200), 10, 30);
  for (const line of out.split('\n')) assert.ok(line.length <= 34, JSON.stringify(line));
});

test('the budget is a limit, not a suggestion', async () => {
  const out = await render(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'), 6);
  assert.match(out, /line 0/);
  assert.doesNotMatch(out, /line 50/);
});
