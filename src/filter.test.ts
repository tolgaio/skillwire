import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Artifact, Kind } from './artifact.js';
import type { Wire } from './config.js';
import { matches, matchesArtifact, selectArtifacts } from './filter.js';

const a = (id: string, kind: Kind = 'skill'): Artifact => ({
  kind,
  id,
  name: id,
  description: '',
  body: '',
  raw: '',
  files: [],
  meta: {},
  path: `/tmp/${id}`,
});

const wire = (w: Partial<Wire>): Wire => ({
  name: 'w',
  source: { path: '/tmp' },
  targets: [],
  ...w,
});

test('a pattern without a wildcard must match exactly', () => {
  assert.ok(matches('deploy', 'deploy'));
  assert.ok(!matches('deploy-web', 'deploy'));
  assert.ok(!matches('deploy', 'deploy-web'));
});

test('* matches any run of characters', () => {
  assert.ok(matches('deploy-web', 'deploy-*'));
  assert.ok(matches('deploy-', 'deploy-*'), '* may match nothing');
  assert.ok(matches('a-b-c', '*-b-*'));
  assert.ok(matches('anything', '*'));
  assert.ok(!matches('web-deploy', 'deploy-*'));
});

test('regex metacharacters in a pattern are literal', () => {
  // Otherwise a dot would match any character, and a pattern like "a.b" would
  // quietly catch "axb".
  assert.ok(matches('a.b', 'a.b'));
  assert.ok(!matches('axb', 'a.b'));
  assert.ok(matches('c++', 'c++'));
  assert.ok(matches('a(b)', 'a(b)'));
});

test('an unscoped pattern applies to every kind', () => {
  assert.ok(matchesArtifact(a('x-one', 'skill'), 'x-*'));
  assert.ok(matchesArtifact(a('x-one', 'command'), 'x-*'));
  assert.ok(matchesArtifact(a('x-one', 'agent'), 'x-*'));
});

test('a kind-scoped pattern only matches that kind', () => {
  // This is the bug the scope exists for: excluding a skill collection by
  // prefix otherwise catches commands and agents that merely share it.
  assert.ok(matchesArtifact(a('vendored-thing', 'skill'), 'skill:vendored-*'));
  assert.ok(!matchesArtifact(a('vendored-import', 'command'), 'skill:vendored-*'));
  assert.ok(!matchesArtifact(a('vendored-sync', 'agent'), 'skill:vendored-*'));
});

test('a colon that is not a known kind is treated as part of the pattern', () => {
  assert.ok(matchesArtifact(a('ns:thing'), 'ns:thing'));
  assert.ok(!matchesArtifact(a('thing'), 'ns:thing'));
});

test('only acts as a whitelist', () => {
  const all = [a('keep-one'), a('keep-two'), a('drop')];
  const got = selectArtifacts(all, wire({ only: ['keep-*'] })).map((x) => x.id);
  assert.deepEqual(got, ['keep-one', 'keep-two']);
});

test('exclude removes from what survives only', () => {
  const all = [a('keep'), a('keep-draft'), a('other')];
  const got = selectArtifacts(all, wire({ only: ['keep*'], exclude: ['*-draft'] })).map((x) => x.id);
  assert.deepEqual(got, ['keep']);
});

test('no filters means everything', () => {
  const all = [a('one'), a('two', 'command')];
  assert.equal(selectArtifacts(all, wire({})).length, 2);
});

test('several patterns are OR-ed', () => {
  const all = [a('a1'), a('b1'), a('c1')];
  const got = selectArtifacts(all, wire({ only: ['a*', 'b*'] })).map((x) => x.id);
  assert.deepEqual(got, ['a1', 'b1']);
});

test('excluding one kind leaves the others', () => {
  const all = [a('shared', 'skill'), a('shared', 'command'), a('shared', 'agent')];
  const got = selectArtifacts(all, wire({ exclude: ['skill:shared'] }));
  assert.deepEqual(got.map((x) => x.kind), ['command', 'agent']);
});

test('an empty filter array is not a filter', () => {
  const all = [a('one'), a('two')];
  assert.equal(selectArtifacts(all, wire({ only: [], exclude: [] })).length, 2);
});

test('an only list scoped to one kind leaves the other kinds alone', () => {
  // `only` is a whitelist, so anything it did not name was dropped — including
  // whole kinds it never mentioned. Naming a kind is a statement about that
  // kind, not a decision to install nothing else.
  const all = [a('keep', 'skill'), a('drop', 'skill'), a('cmd', 'command'), a('agt', 'agent')];
  const got = selectArtifacts(all, wire({ only: ['skill:keep'] }));
  assert.deepEqual(
    got.map((x) => `${x.kind}:${x.id}`),
    ['skill:keep', 'command:cmd', 'agent:agt'],
  );
});

test('one unscoped pattern still speaks for every kind', () => {
  const all = [a('keep', 'skill'), a('keep', 'command'), a('other', 'agent')];
  const got = selectArtifacts(all, wire({ only: ['keep'] }));
  assert.deepEqual(
    got.map((x) => `${x.kind}:${x.id}`),
    ['skill:keep', 'command:keep'],
  );
});

test('scoping two kinds restricts both and spares the third', () => {
  const all = [
    a('yes', 'skill'),
    a('no', 'skill'),
    a('yes', 'command'),
    a('no', 'command'),
    a('untouched', 'agent'),
  ];
  const got = selectArtifacts(all, wire({ only: ['skill:yes', 'command:yes'] }));
  assert.deepEqual(
    got.map((x) => `${x.kind}:${x.id}`),
    ['skill:yes', 'command:yes', 'agent:untouched'],
  );
});

test('mixing a scoped and an unscoped pattern restricts everything', () => {
  const all = [a('x', 'skill'), a('other', 'skill'), a('x', 'agent'), a('other', 'agent')];
  const got = selectArtifacts(all, wire({ only: ['skill:x', 'x'] }));
  assert.deepEqual(
    got.map((x) => `${x.kind}:${x.id}`),
    ['skill:x', 'agent:x'],
  );
});

test('exclude is unaffected: it removes whatever it names, from any kind', () => {
  const all = [a('x', 'skill'), a('x', 'command')];
  const got = selectArtifacts(all, wire({ only: ['skill:x'], exclude: ['command:x'] }));
  assert.deepEqual(got.map((x) => `${x.kind}:${x.id}`), ['skill:x']);
});

test('include puts back what exclude took', () => {
  // One artifact inside an excluded collection could not be had at all:
  // exclude has the last word, so keeping a single skill out of a pattern
  // covering two hundred meant giving up the pattern.
  const all = [a('vendored-one'), a('vendored-two'), a('mine')];
  const got = selectArtifacts(
    all,
    wire({ exclude: ['skill:vendored-*'], include: ['skill:vendored-one'] }),
  );
  assert.deepEqual(got.map((x) => x.id), ['vendored-one', 'mine']);
});

test('include is matched last, so an exclude cannot undo it', () => {
  const all = [a('one'), a('two')];
  const got = selectArtifacts(all, wire({ exclude: ['*'], include: ['skill:one'] }));
  assert.deepEqual(got.map((x) => x.id), ['one']);
});

test('include reaches past only as well', () => {
  const all = [a('kept'), a('other')];
  const got = selectArtifacts(all, wire({ only: ['skill:kept'], include: ['skill:other'] }));
  assert.deepEqual(got.map((x) => x.id).sort(), ['kept', 'other']);
});

test('include keeps the order the source gave', () => {
  const all = [a('a1'), a('b1'), a('c1')];
  const got = selectArtifacts(all, wire({ exclude: ['b1'], include: ['b1'] }));
  assert.deepEqual(got.map((x) => x.id), ['a1', 'b1', 'c1']);
});

test('an include naming nothing changes nothing', () => {
  const all = [a('one')];
  assert.deepEqual(
    selectArtifacts(all, wire({ include: ['skill:nope'] })).map((x) => x.id),
    ['one'],
  );
});
