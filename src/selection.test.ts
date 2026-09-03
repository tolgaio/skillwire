import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Artifact, Kind } from './artifact.js';
import type { Wire } from './config.js';
import { selectArtifacts } from './filter.js';
import {
  blockingExclude,
  compact,
  isSelected,
  patternCounts,
  setSelection,
  toggle,
} from './selection.js';

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

const wire = (w: Partial<Wire> = {}): Wire => ({
  name: 'w',
  source: { path: '/tmp' },
  targets: [],
  ...w,
});

const ids = (all: Artifact[], w: Wire) => selectArtifacts(all, w).map((x) => x.id);

test('with no filters, everything is selected', () => {
  const all = [a('one'), a('two')];
  assert.ok(all.every((x) => isSelected(x, wire())));
});

test('unticking one artifact excludes exactly it', () => {
  const all = [a('one'), a('two'), a('three')];
  const w = toggle(wire(), all[1]!, false);
  assert.deepEqual(w.exclude, ['skill:two']);
  assert.deepEqual(ids(all, w), ['one', 'three']);
});

test('ticking it back removes the exclusion rather than adding an only', () => {
  const all = [a('one'), a('two')];
  let w = toggle(wire(), all[1]!, false);
  w = toggle(w, all[1]!, true);
  assert.equal(w.exclude, undefined, 'the filter is gone, not left empty');
  assert.equal(w.only, undefined);
  assert.deepEqual(ids(all, w), ['one', 'two']);
});

test('a glob someone wrote survives ticking an unrelated artifact', () => {
  // The whole reason the edits are minimal: a picker that flattened
  // exclude: ["skill:vendored-*"] into literals the first time you touched
  // anything would throw away the intent behind it.
  const all = [a('vendored-x'), a('mine'), a('other')];
  const w = toggle(wire({ exclude: ['skill:vendored-*'] }), all[2]!, false);
  assert.ok(w.exclude!.includes('skill:vendored-*'));
  assert.deepEqual(ids(all, w), ['mine']);
});

test('an artifact inside an excluded glob cannot be ticked, and says which glob', () => {
  // exclude has the last word and the language cannot say "except this one".
  // Adding it to `only` would restrict the wire to that one artifact and then
  // exclude it anyway, selecting nothing — so the tick is refused instead.
  const all = [a('vendored-x'), a('vendored-y'), a('mine')];
  const w = wire({ exclude: ['skill:vendored-*'] });
  assert.equal(blockingExclude(all[0]!, w), 'skill:vendored-*');
  assert.deepEqual(ids(all, toggle(w, all[0]!, true)), ['mine'], 'nothing silently changed');
});

test('an artifact an only list merely omits can be ticked, because only is a union', () => {
  const all = [a('x-1'), a('y')];
  const w = toggle(wire({ only: ['x-*'] }), all[1]!, true);
  assert.deepEqual(ids(all, w), ['x-1', 'y']);
  assert.ok(w.only!.includes('x-*'), 'the glob survives');
});

test('an exact exclude is just removed, no glob involved', () => {
  const all = [a('one'), a('two')];
  const w = toggle(wire({ exclude: ['skill:one'] }), all[0]!, true);
  assert.deepEqual(ids(all, w), ['one', 'two']);
  assert.equal(blockingExclude(all[0]!, wire({ exclude: ['skill:one'] })), undefined);
});

test('unticking the last item of an only list selects nothing, not everything', () => {
  // only: [] means "no filter", so emptying the list would silently select the
  // whole source — the opposite of what unticking asks for.
  const all = [a('one'), a('two')];
  const w = toggle(wire({ only: ['skill:one'] }), all[0]!, false);
  assert.deepEqual(ids(all, w), []);
});

test('a kind-scoped id does not tick its namesake in another kind', () => {
  const all = [a('deploy', 'skill'), a('deploy', 'command')];
  const w = toggle(wire(), all[0]!, false);
  assert.deepEqual(
    selectArtifacts(all, w).map((x) => x.kind),
    ['command'],
  );
});

test('picking a few from many is stored as an allowlist, not hundreds of excludes', () => {
  const all = Array.from({ length: 50 }, (_, i) => a(`s${i}`));
  const w = setSelection(wire(), all, all.slice(3), false); // untick all but three
  assert.deepEqual(ids(all, w), ['s0', 's1', 's2']);
  assert.ok(w.only!.length === 3 && !w.exclude, JSON.stringify(w));
});

test('dropping a few from many is stored as a denylist', () => {
  const all = Array.from({ length: 50 }, (_, i) => a(`s${i}`));
  const w = setSelection(wire(), all, all.slice(0, 2), false);
  assert.equal(w.only, undefined);
  assert.equal(w.exclude!.length, 2);
});

test('compaction never rewrites a wire that has globs', () => {
  const all = [a('vendored-x'), a('mine')];
  const w = compact(wire({ exclude: ['skill:vendored-*'] }), all);
  assert.deepEqual(w.exclude, ['skill:vendored-*']);
});

test('selecting everything clears the filters entirely', () => {
  const all = [a('one'), a('two')];
  const w = setSelection(wire({ exclude: ['skill:one'] }), all, all, true);
  assert.equal(w.only, undefined);
  assert.equal(w.exclude, undefined);
});

test('a bulk tick only touches what it was given', () => {
  const all = [a('one'), a('two'), a('three')];
  const w = setSelection(wire(), all, [all[0]!, all[1]!], false);
  assert.deepEqual(ids(all, w), ['three']);
});

test('toggling is stable: the same tick twice changes nothing further', () => {
  const all = [a('one'), a('two')];
  const once = toggle(wire(), all[0]!, false);
  const twice = toggle(once, all[0]!, false);
  assert.deepEqual(twice, once);
});

test('pattern counts report what each pattern actually matches', () => {
  const all = [a('x-1'), a('x-2'), a('y')];
  const counts = patternCounts(wire({ only: ['x-*'], exclude: ['y'] }), all);
  assert.equal(counts.get('x-*'), 2);
  assert.equal(counts.get('y'), 1);
});

test('a pattern matching nothing is reported as zero, not hidden', () => {
  const counts = patternCounts(wire({ only: ['gone-*'] }), [a('one')]);
  assert.equal(counts.get('gone-*'), 0);
});
