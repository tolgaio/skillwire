import { KINDS, type Artifact, type Kind } from './artifact.js';
import type { Wire } from './config.js';

/**
 * Match an id against a pattern, where `*` matches any run of characters.
 *
 * Globs rather than exact ids because a source collection installs under a
 * shared prefix — excluding a 232-skill collection should be one pattern, not
 * 232 literals.
 */
export function matches(id: string, pattern: string): boolean {
  if (!pattern.includes('*')) return id === pattern;
  const re = new RegExp(
    '^' + pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
  );
  return re.test(id);
}

/**
 * Match an artifact against a pattern, optionally scoped to one kind:
 *
 *   vendored-*         any artifact whose id starts with vendored-
 *   skill:vendored-*   only skills
 *
 * The scoped form matters more than it looks. Excluding a skill collection by
 * prefix will otherwise catch unrelated commands and agents that happen to
 * share it — a `vendored-import` command is not part of the vendored skill
 * collection.
 */
export function matchesArtifact(a: Artifact, pattern: string): boolean {
  const i = pattern.indexOf(':');
  if (i > 0) {
    const kind = pattern.slice(0, i);
    if (KINDS.includes(kind as Kind)) {
      return a.kind === kind && matches(a.id, pattern.slice(i + 1));
    }
  }
  return matches(a.id, pattern);
}

/** The kind a pattern is scoped to, or null when it applies to all of them. */
export function scopeOf(pattern: string): Kind | null {
  const i = pattern.indexOf(':');
  if (i <= 0) return null;
  const kind = pattern.slice(0, i);
  return KINDS.includes(kind as Kind) ? (kind as Kind) : null;
}

/**
 * Which kinds an `only` list has an opinion about.
 *
 * `only` is a whitelist, so anything it does not name is dropped — and that
 * used to include whole kinds it never mentioned. `only: ["command:review"]`
 * meant "one command, and no skills or agents at all", which is not what
 * anyone writing it meant: naming a kind is a statement about that kind.
 *
 * An unscoped pattern is still a statement about everything, so one of those
 * puts every kind back in scope.
 */
function restricted(only: string[]): Set<Kind> | null {
  const kinds = new Set<Kind>();
  for (const pattern of only) {
    const kind = scopeOf(pattern);
    if (!kind) return null; // unscoped: every kind is restricted
    kinds.add(kind);
  }
  return kinds;
}

export function selectArtifacts(all: Artifact[], wire: Wire): Artifact[] {
  let out = all;
  if (wire.only?.length) {
    const scope = restricted(wire.only);
    out = out.filter(
      (a) => (scope && !scope.has(a.kind)) || wire.only!.some((p) => matchesArtifact(a, p)),
    );
  }
  if (wire.exclude?.length)
    out = out.filter((a) => !wire.exclude!.some((p) => matchesArtifact(a, p)));
  return out;
}
