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

export function selectArtifacts(all: Artifact[], wire: Wire): Artifact[] {
  let out = all;
  if (wire.only?.length)
    out = out.filter((a) => wire.only!.some((p) => matchesArtifact(a, p)));
  if (wire.exclude?.length)
    out = out.filter((a) => !wire.exclude!.some((p) => matchesArtifact(a, p)));
  return out;
}
