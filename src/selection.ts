import type { Artifact } from './artifact.js';
import type { Wire } from './config.js';
import { matchesArtifact, selectArtifacts } from './filter.js';

/**
 * Turning a ticked checkbox into `only`/`exclude`, and back.
 *
 * The config's filters are the single representation of what a wire installs —
 * the interactive picker does not get a parallel list of its own, because two
 * representations of the same thing drift the moment someone edits the file by
 * hand. So ticking a box has to be expressed as an edit to the patterns.
 *
 * The edits are deliberately *minimal*. A wire whose filters read
 * `exclude: ["skill:vendored-*"]` should still read that after you tick one
 * unrelated skill: a picker that flattened every glob into a few hundred
 * literals the first time you touched it would make the config unreadable and
 * throw away the intent behind it.
 */

const exact = (p: string) => !p.includes('*');

/** The pattern that says "none of it". */
const EMPTY = '*';

/** The literal forms that name exactly this artifact and nothing else. */
function literals(a: Artifact): string[] {
  return [`${a.kind}:${a.id}`, a.id];
}

export function isSelected(a: Artifact, wire: Wire): boolean {
  return selectArtifacts([a], wire).length === 1;
}

export function selectedIds(all: Artifact[], wire: Wire): Set<string> {
  return new Set(selectArtifacts(all, wire).map((a) => `${a.kind}:${a.id}`));
}

function withFilters(
  wire: Wire,
  only: string[],
  exclude: string[],
  include: string[] = wire.include ?? [],
): Wire {
  const out: Wire = { ...wire };
  if (only.length) out.only = only;
  else delete out.only;
  if (exclude.length) out.exclude = exclude;
  else delete out.exclude;
  if (include.length) out.include = include;
  else delete out.include;
  return out;
}

/**
 * The glob in `exclude` that keeps this artifact out, if there is one.
 *
 * `only` is a union, so anything it blocks can be let back in by adding one
 * more entry. `exclude` is not: it has the last word and the language has no
 * way to say "except this one". A single artifact inside an excluded glob
 * therefore cannot be ticked without rewriting the glob, and pretending
 * otherwise would silently produce a config that means something else.
 */
export function blockingExclude(a: Artifact, wire: Wire): string | undefined {
  return (wire.exclude ?? []).find((p) => !exact(p) && matchesArtifact(a, p));
}

/** Which patterns a wire has, for a screen that wants to say so. */
export function patternsOf(wire: Wire): { field: 'only' | 'exclude' | 'include'; pattern: string }[] {
  return [
    ...(wire.only ?? []).map((pattern) => ({ field: 'only' as const, pattern })),
    ...(wire.exclude ?? []).map((pattern) => ({ field: 'exclude' as const, pattern })),
    ...(wire.include ?? []).map((pattern) => ({ field: 'include' as const, pattern })),
  ];
}

/**
 * Tick or untick one artifact, changing as little as possible.
 *
 * First drop any literal that says the opposite. If the globs alone already
 * give the wanted answer, that is the whole edit and no literal is added.
 *
 * Returns the wire unchanged when the change cannot be expressed — see
 * blockingExclude, and check it before calling if you want to explain why.
 */
export function toggle(wire: Wire, a: Artifact, on: boolean): Wire {
  const names = literals(a);
  let only = wire.only ?? [];
  let exclude = wire.exclude ?? [];
  let include = wire.include ?? [];

  if (on) {
    exclude = exclude.filter((p) => !(exact(p) && names.includes(p)));
  } else {
    // Whatever put it back, take it back out first.
    include = include.filter((p) => !(exact(p) && names.includes(p)));
    const kept = only.filter((p) => !(exact(p) && names.includes(p)));
    // An `only` list that empties out stops meaning "just these" and starts
    // meaning "everything", which would select far more than was ticked. Keep
    // it, and let the exclude below do the work.
    if (kept.length || !only.length) only = kept;
  }

  const candidate = withFilters(wire, only, exclude, include);
  if (isSelected(a, candidate) === on) return candidate;

  if (!on) return withFilters(wire, only, [...exclude, `${a.kind}:${a.id}`], include);

  const widened = withFilters(wire, [...only, `${a.kind}:${a.id}`], exclude, include);
  if (isSelected(a, widened)) return widened;

  // Still out, so a pattern is holding it out and no amount of `only` will
  // help: `exclude` has the last word. `include` is matched after it, and
  // names one artifact without touching the pattern that covers the rest.
  return withFilters(wire, only, exclude, [...include, `${a.kind}:${a.id}`]);
}

/**
 * Rewrite literal-only filters into whichever of the two forms is shorter.
 *
 * Ticking three of five hundred skills one at a time otherwise leaves four
 * hundred and ninety-seven excludes. Runs only when the wire has no globs:
 * a pattern someone wrote is worth more than a shorter file.
 */
export function compact(wire: Wire, all: Artifact[]): Wire {
  const selected = selectArtifacts(all, wire).length;

  // Nothing selected is an end state worth saying outright: `only: []` reads
  // as "no filter", so without a pattern for it there was no way to express an
  // empty source and the picker had to refuse to make one.
  if (all.length && !selected) return withFilters({ ...wire }, [], [EMPTY], []);

  // Everything selected is no filters at all — but only when there is no glob
  // to lose. Ticking one artifact back should not wipe a pattern that governs
  // two hundred others. The empty marker is this module's own, so it goes.
  // The empty marker is this module's own, so it is not a pattern to protect.
  const globs = [...(wire.only ?? []), ...(wire.exclude ?? [])].filter(
    (p) => !exact(p) && p !== EMPTY,
  );
  if (all.length && selected === all.length && !globs.length) {
    return withFilters({ ...wire }, [], [], []);
  }

  // A glob someone wrote is worth more than a shorter file, and an include
  // only exists to override one — so neither is rewritten away.
  if (globs.length) return wire;
  if (wire.include?.length && !wire.exclude?.includes(EMPTY)) return wire;

  const ids = (list: Artifact[]) => list.map((a) => `${a.kind}:${a.id}`).sort();
  const kept = selectArtifacts(all, wire);
  const dropped = all.filter((a) => !isSelected(a, wire));
  return kept.length <= dropped.length
    ? withFilters(wire, ids(kept), [], [])
    : withFilters(wire, [], ids(dropped), []);
}

/**
 * Tick or untick a whole set, then tidy up.
 *
 * Emptying a source entirely is a thing people do — turning one off without
 * deleting it — and it used to be refused because `only: []` reads as "no
 * filter" rather than "nothing". `exclude: ["*"]` says it outright, in the
 * language that is already there, and `include` can still name exceptions.
 */
export function setSelection(wire: Wire, all: Artifact[], subset: Artifact[], on: boolean): Wire {
  let out = wire;
  for (const a of subset) {
    if (isSelected(a, out) !== on) out = toggle(out, a, on);
  }
  return compact(out, all);
}

/** Which of a wire's patterns actually match something, and how much. */
export function patternCounts(wire: Wire, all: Artifact[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of [...(wire.only ?? []), ...(wire.exclude ?? [])]) {
    counts.set(p, all.filter((a) => matchesArtifact(a, p)).length);
  }
  return counts;
}
