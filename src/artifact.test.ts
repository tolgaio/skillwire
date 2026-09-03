import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFrontmatter, withName } from './artifact.js';

test('parses flat frontmatter', () => {
  const { meta, body } = parseFrontmatter('---\nname: a\ndescription: b\n---\n\n# Body\n');
  assert.equal(meta.name, 'a');
  assert.equal(meta.description, 'b');
  // Everything after the closing separator is kept verbatim, blank line
  // included. Trimming would be tidier to look at but would mean the body a
  // target stores no longer matches the file on disk byte for byte.
  assert.equal(body, '\n# Body\n');
});

test('returns the body unchanged when there is no frontmatter', () => {
  // Real repos contain skills without it; refusing to read them would be wrong.
  const raw = '# Just a heading\n\ntext\n';
  const { meta, body } = parseFrontmatter(raw);
  assert.deepEqual(meta, {});
  assert.equal(body, raw);
});

test('treats unterminated frontmatter as no frontmatter', () => {
  const raw = '---\nname: a\nstill going\n';
  const { meta, body } = parseFrontmatter(raw);
  assert.deepEqual(meta, {});
  assert.equal(body, raw);
});

test('keeps nested values as raw text rather than dropping the artifact', () => {
  const { meta } = parseFrontmatter(
    '---\nname: a\nmetadata:\n  key: value\n  other: thing\n---\nbody\n',
  );
  assert.equal(meta.name, 'a');
  assert.match(meta.metadata!, /key: value/);
  assert.match(meta.metadata!, /other: thing/);
});

test('a quoted value loses the quotes, which are YAML syntax not text', () => {
  // Quoting is how a description containing a colon gets written at all. The
  // quotes are not part of it, and showing them in a listing is just wrong.
  const { meta } = parseFrontmatter('---\ndescription: "auth: tokens, keys"\n---\nx\n');
  assert.equal(meta.description, 'auth: tokens, keys');
  assert.equal(parseFrontmatter("---\nname: 'a: b'\n---\nx\n").meta.name, 'a: b');
});

test('quotes inside a value survive', () => {
  assert.equal(
    parseFrontmatter('---\ndescription: he said "no"\n---\nx\n').meta.description,
    'he said "no"',
  );
  assert.equal(
    parseFrontmatter('---\ndescription: "he said \\"no\\""\n---\nx\n').meta.description,
    'he said "no"',
  );
});

test('an unbalanced quote is left alone rather than half-stripped', () => {
  assert.equal(parseFrontmatter('---\ndescription: "oops\n---\nx\n').meta.description, '"oops');
});

test('handles a key with an empty value', () => {
  const { meta } = parseFrontmatter('---\nname: a\ntags:\n---\nx\n');
  assert.equal(meta.tags, '');
});

test('body preserves its own --- separators', () => {
  const { body } = parseFrontmatter('---\nname: a\n---\n\nintro\n\n---\n\noutro\n');
  assert.match(body, /intro/);
  assert.match(body, /outro/);
  assert.match(body, /^---$/m);
});

test('withName replaces an existing name', () => {
  const out = withName('---\nname: old\ndescription: d\n---\nbody\n', 'new');
  const { meta, body } = parseFrontmatter(out);
  assert.equal(meta.name, 'new');
  assert.equal(meta.description, 'd', 'other keys must survive');
  assert.equal(body, 'body\n');
});

test('withName inserts a name when frontmatter lacks one', () => {
  const out = withName('---\ndescription: d\n---\nbody\n', 'added');
  const { meta } = parseFrontmatter(out);
  assert.equal(meta.name, 'added');
  assert.equal(meta.description, 'd');
});

test('withName adds frontmatter when there is none', () => {
  const out = withName('# Heading\n', 'fresh');
  const { meta, body } = parseFrontmatter(out);
  assert.equal(meta.name, 'fresh');
  assert.match(body, /# Heading/);
});

test('withName rewrites only the name line', () => {
  // A description mentioning "name:" must not be rewritten as well.
  const out = withName('---\nname: old\ndescription: sets name: foo\n---\nb\n', 'new');
  const { meta } = parseFrontmatter(out);
  assert.equal(meta.name, 'new');
  assert.equal(meta.description, 'sets name: foo');
});

test('withName is idempotent', () => {
  const once = withName('---\nname: a\n---\nb\n', 'x');
  assert.equal(withName(once, 'x'), once);
});

test('a literal block scalar keeps its line breaks', () => {
  const { meta } = parseFrontmatter(
    '---\nname: a\ndescription: |\n  first line\n  second line\n---\nbody\n',
  );
  assert.equal(meta.description, 'first line\nsecond line');
});

test('a folded block scalar joins the lines the author wrapped', () => {
  // `>` means the breaks are the author's editor, not their intent. Keeping
  // them would put a newline in the middle of every description.
  const { meta } = parseFrontmatter(
    '---\ndescription: >\n  one two\n  three four\n---\nbody\n',
  );
  assert.equal(meta.description, 'one two three four');
});

test('a folded scalar keeps paragraph breaks', () => {
  const { meta } = parseFrontmatter(
    '---\ndescription: >\n  para one\n  still one\n\n  para two\n---\nb\n',
  );
  assert.equal(meta.description, 'para one still one\npara two');
});

test('chomping and indent indicators are accepted', () => {
  for (const ind of ['|-', '|+', '>-', '>+']) {
    const { meta } = parseFrontmatter(`---\ndescription: ${ind}\n  text here\n---\nb\n`);
    assert.equal(meta.description, 'text here', ind);
  }
});

test('the indicator itself never becomes the value', () => {
  // The bug this replaced: the description read ">" and the text was lost.
  const { meta } = parseFrontmatter('---\ndescription: >\n  real text\n---\nb\n');
  assert.doesNotMatch(meta.description!, /^[|>]/);
});

test('a block scalar ends at the next key', () => {
  const { meta } = parseFrontmatter(
    '---\ndescription: |\n  the text\nname: after\n---\nb\n',
  );
  assert.equal(meta.description, 'the text');
  assert.equal(meta.name, 'after');
});

test('a block scalar is dedented by its own indentation', () => {
  const { meta } = parseFrontmatter(
    '---\ndescription: |\n    deep one\n    deep two\n---\nb\n',
  );
  assert.equal(meta.description, 'deep one\ndeep two');
});

test('an empty block scalar is empty, not the indicator', () => {
  const { meta } = parseFrontmatter('---\ndescription: |\nname: x\n---\nb\n');
  assert.equal(meta.description, '');
  assert.equal(meta.name, 'x');
});
