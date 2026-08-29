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

test('handles values containing colons', () => {
  const { meta } = parseFrontmatter('---\ndescription: "auth: tokens, keys"\n---\nx\n');
  assert.equal(meta.description, '"auth: tokens, keys"');
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
