import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Skill } from '../skill.js';

export interface InstallResult {
  installed: string[];
  skipped: { id: string; reason: string }[];
  /** Paths or identifiers written, for reporting. */
  wrote: string[];
}

export interface InstallOptions {
  dryRun?: boolean;
  /** Remove skills present at the target but absent from the source. */
  prune?: boolean;
  /**
   * Absolute path the skills were read from. Filesystem targets use it to
   * refuse writing into their own source — see assertNotInsideSource.
   */
  sourceRoot?: string;
}

/**
 * Refuse to install into a directory that is inside the source, or that
 * contains it.
 *
 * This is not hypothetical. The conventional way to make skills visible to
 * Claude Code is to symlink ~/.claude/skills at the repo holding them, which
 * makes the target path resolve back to the source. Since installing replaces
 * each skill directory, that would rewrite the repo in place — and wiring a
 * *different* source at the same target would overwrite one repo's skills with
 * another's.
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
        `A symlinked skills directory would make this rewrite the source repo.`,
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
 * A destination for skills.
 *
 * The interface is deliberately behavioural — `install()` rather than a
 * `skillsDir` string — because not every target is a filesystem. Multica is an
 * HTTP API behind a CLI, and hermes wants a different on-disk shape from the
 * flat SKILL.md layout everything else uses. A declarative "here is my
 * directory" contract cannot express either, which is the limitation that made
 * an existing tool unusable for this set of targets.
 */
export interface Target {
  /** Stable identifier used in config and on the command line. */
  readonly id: string;
  /** Human-readable name for output. */
  readonly name: string;
  /** Is this target present on the current machine? */
  detect(): Promise<boolean>;
  install(skills: Skill[], opts: InstallOptions): Promise<InstallResult>;
}

export function emptyResult(): InstallResult {
  return { installed: [], skipped: [], wrote: [] };
}

/**
 * Write a skill's files verbatim into `dest`, replacing whatever was there.
 *
 * Replace rather than merge: a skill that drops a file should not leave the
 * stale copy behind, where an agent would still read it.
 */
export async function writeSkillTree(
  skill: Skill,
  dest: string,
  dryRun = false,
): Promise<string> {
  if (dryRun) return dest;
  await rm(dest, { recursive: true, force: true });
  for (const f of skill.files) {
    const out = join(dest, f.path);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, f.bytes);
  }
  return dest;
}
