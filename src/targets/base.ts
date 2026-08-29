import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { filesWithIdAsName, isDirKind, type Artifact, type Kind } from '../artifact.js';

export interface InstallResult {
  installed: string[];
  skipped: { id: string; reason: string }[];
  wrote: string[];
}

export interface InstallOptions {
  dryRun?: boolean;
  /** Remove artifacts present at the target but absent from the source. */
  prune?: boolean;
  /**
   * What this wire installed at this target on its last run, from the manifest,
   * as `kind:id` entries.
   *
   * Qualified by kind because an id is only unique within one: a repo may hold
   * both a skill and a command called `deploy`, and dropping one must not prune
   * the other.
   *
   * Prune removes exactly the ids that were installed before and are not being
   * installed now. Anything absent from this list was not put here by this
   * wire, so it is left alone — that covers other wires, artifacts installed by
   * hand, and a harness's own bundled content.
   *
   * When it is undefined there is no record, so prune does nothing rather than
   * guessing.
   */
  previouslyInstalled?: string[];
  /**
   * Absolute path the artifacts were read from. Filesystem targets use it to
   * refuse writing into their own source — see assertNotInsideSource.
   */
  sourceRoot?: string;
}

/**
 * A destination for artifacts.
 *
 * The interface is deliberately behavioural — `install()` rather than a
 * `skillsDir` string — because not every target is a filesystem. Multica is an
 * HTTP API behind a CLI, and Hermes wants a different on-disk shape from the
 * flat layout everything else uses. A declarative "here is my directory"
 * contract cannot express either.
 */
export interface Target {
  readonly id: string;
  readonly name: string;
  /** Which kinds this target can accept. Others are reported as skipped. */
  readonly kinds: Kind[];
  detect(): Promise<boolean>;
  install(artifacts: Artifact[], opts: InstallOptions): Promise<InstallResult>;
}

export function emptyResult(): InstallResult {
  return { installed: [], skipped: [], wrote: [] };
}

/**
 * Split off artifacts this target cannot take, recording why.
 *
 * Every target calls this rather than silently dropping them: a command wired
 * at a target with no notion of commands should say so, not vanish.
 */
export function partitionByKind(
  artifacts: Artifact[],
  kinds: Kind[],
  targetName: string,
): { accepted: Artifact[]; result: InstallResult } {
  const result = emptyResult();
  const accepted: Artifact[] = [];
  // Aggregate per kind rather than per artifact: a repo with 238 commands wired
  // at a target that takes none should produce one line, not 238.
  const rejected = new Map<Kind, number>();
  for (const a of artifacts) {
    if (kinds.includes(a.kind)) accepted.push(a);
    else rejected.set(a.kind, (rejected.get(a.kind) ?? 0) + 1);
  }
  for (const [kind, n] of rejected) {
    result.skipped.push({
      id: `${n} ${kind}${n === 1 ? '' : 's'}`,
      reason: `${targetName} takes no ${kind}s`,
    });
  }
  return { accepted, result };
}

/**
 * Refuse to install into a directory that is inside the source, or that
 * contains it.
 *
 * This is not hypothetical. The conventional way to expose skills, agents and
 * commands to Claude Code is to symlink ~/.claude/<kind> at the repo holding
 * them, which makes the target path resolve back to the source. Since
 * installing replaces each artifact, that would rewrite the repo in place — and
 * wiring a different source at the same target would overwrite one repo's
 * content with another's.
 *
 * Both paths are resolved through symlinks before comparing, because the whole
 * problem is that the target is a link.
 */
export async function assertNotInsideSource(
  targetDir: string,
  sourceRoot: string | undefined,
  targetName: string,
): Promise<void> {
  if (!sourceRoot) return;
  const [t, s] = await Promise.all([realish(targetDir), realish(sourceRoot)]);
  const inside = (a: string, b: string) => a === b || a.startsWith(b + sep);
  if (inside(t, s) || inside(s, t)) {
    throw new Error(
      `refusing to install: ${targetName} resolves to ${t}, which is inside the source ${s}. ` +
        `A symlinked directory would make this rewrite the source repo.`,
    );
  }
}

/** realpath, tolerating a path that does not exist yet. */
async function realish(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    try {
      return join(await realpath(dirname(p)), p.split(sep).pop()!);
    } catch {
      return resolve(p);
    }
  }
}

/**
 * Write an artifact under `kindDir`, replacing whatever was there.
 *
 * Replace rather than merge: an artifact that drops a file should not leave the
 * stale copy behind, where an agent would still read it.
 *
 * Returns the path written, which is a directory for skills and a file for
 * commands and agents.
 *
 * The primary markdown's frontmatter `name` is rewritten to the artifact's id,
 * so an installed artifact agrees with the name it was installed under. The
 * source file is untouched.
 */
export async function writeArtifact(
  artifact: Artifact,
  kindDir: string,
  dryRun = false,
): Promise<string> {
  if (isDirKind(artifact.kind)) {
    const dest = join(kindDir, artifact.id);
    if (dryRun) return dest;
    await rm(dest, { recursive: true, force: true });
    for (const f of filesWithIdAsName(artifact)) {
      const out = join(dest, f.path);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, f.bytes);
    }
    return dest;
  }

  const dest = join(kindDir, `${artifact.id}.md`);
  if (dryRun) return dest;
  await mkdir(kindDir, { recursive: true });
  await writeFile(dest, filesWithIdAsName(artifact)[0]!.bytes);
  return dest;
}
