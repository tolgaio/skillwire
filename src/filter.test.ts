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
