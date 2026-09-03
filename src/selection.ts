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

function withFilters(wire: Wire, only: string[], exclude: string[]): Wire {
  const out: Wire = { ...wire };
  if (only.length) out.only = only;
  else delete out.only;
  if (exclude.length) out.exclude = exclude;
  else delete out.exclude;
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

  if (on) {
    exclude = exclude.filter((p) => !(exact(p) && names.includes(p)));
  } else {
    const kept = only.filter((p) => !(exact(p) && names.includes(p)));
    // An `only` list that empties out stops meaning "just these" and starts
    // meaning "everything", which would select far more than was ticked. Keep
    // it, and let the exclude below do the work.
    if (kept.length || !only.length) only = kept;
  }

  const candidate = withFilters(wire, only, exclude);
  if (isSelected(a, candidate) === on) return candidate;

  if (!on) return withFilters(wire, only, [...exclude, `${a.kind}:${a.id}`]);

  const widened = withFilters(wire, [...only, `${a.kind}:${a.id}`], exclude);
  // Adding to `only` while an exclude glob still matches would restrict the
  // whole wire to this one artifact and then drop it — selecting nothing.
  return isSelected(a, widened) ? widened : candidate;
}

/**
 * Rewrite literal-only filters into whichever of the two forms is shorter.
 *
 * Ticking three of five hundred skills one at a time otherwise leaves four
 * hundred and ninety-seven excludes. Runs only when the wire has no globs:
 * a pattern someone wrote is worth more than a shorter file.
 */
export function compact(wire: Wire, all: Artifact[]): Wire {
  const patterns = [...(wire.only ?? []), ...(wire.exclude ?? [])];
  if (patterns.some((p) => !exact(p))) return wire;

  const selected = selectArtifacts(all, wire);
  // Nothing selected cannot be said with `only` alone — an empty list reads as
  // "no filter". Leave whatever expressed it in place.
  if (!selected.length || selected.length === all.length) {
    return selected.length === all.length ? withFilters(wire, [], []) : wire;
  }

  const ids = (list: Artifact[]) => list.map((a) => `${a.kind}:${a.id}`).sort();
  const unselected = all.filter((a) => !isSelected(a, wire));
  return selected.length <= unselected.length
    ? withFilters(wire, ids(selected), [])
    : withFilters(wire, [], ids(unselected));
}

/** Tick or untick a whole set, then tidy up. */
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
