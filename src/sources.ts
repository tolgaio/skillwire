import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  DEFAULT_KIND_DIR,
  isDirKind,
  isSkillDir,
  readFileArtifact,
  readSkillDir,
  type Artifact,
  type Kind,
} from './artifact.js';

export interface Source {
  name: string;
  /** Read every artifact of the given kinds. */
  read(kinds: Kind[]): Promise<Artifact[]>;
}

/** Per-kind subdirectory names, relative to the source root. */
export type KindDirs = Partial<Record<Kind, string>>;

/**
 * Read every artifact of one kind under `dir`, recursing to any depth.
 *
 * An artifact's id is its full path within the kind root, dash-joined:
 *
 *   skills/pdf-export/               -> pdf-export
 *   skills/writing/tone-check/       -> writing-tone-check
 *   skills/vendored/rewrite/default/ -> vendored-rewrite-default
 *
 * Targets install artifacts as direct children of one directory, so a
 * hierarchy has to flatten. Using the basename alone would collide — this repo
 * has four different skills called `default` — and silently overwrite. The full
 * path is unique by construction and says where the thing came from.
 */
async function readKindDir(
  kind: Kind,
  dir: string,
  group?: string,
  prefix = '',
): Promise<Artifact[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // a repo without this kind is normal, not an error
  }

  const out: Artifact[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (isDirKind(kind)) {
      if (!e.isDirectory()) continue;
      const id = prefix + e.name;
      if (await isSkillDir(full)) {
        out.push(await readSkillDir(full, group, id));
        continue;
      }
      // A directory without SKILL.md may still be a collection holding skills
      // one level down — repos mix flat skills with grouped ones. Look inside
      // rather than dropping them silently. A directory that yields nothing is
      // simply not skills, and needs no comment.
      out.push(...(await readKindDir(kind, full, group ?? e.name, `${id}-`)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(
        await readFileArtifact(kind, full, group, prefix + e.name.replace(/\.md$/i, '')),
      );
    } else if (e.isDirectory()) {
      // commands and agents can be filed in subdirectories too
      out.push(...(await readKindDir(kind, full, group, `${prefix}${e.name}-`)));
    }
  }
  return out;
}

/**
 * A repo holding each kind in its own subdirectory:
 *
 *   <root>/skills/<skill>/SKILL.md
 *   <root>/commands/<command>.md
 *   <root>/agents/<agent>.md
 */
export class FlatSource implements Source {
  constructor(
    private root: string,
    private dirs: KindDirs = {},
    public name = resolve(root),
  ) {}

  async read(kinds: Kind[]): Promise<Artifact[]> {
    const out: Artifact[] = [];
    for (const kind of kinds) {
      const sub = this.dirs[kind] ?? DEFAULT_KIND_DIR[kind];
      out.push(...(await readKindDir(kind, join(this.root, sub))));
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
}

/**
 * A repo grouping each kind under a plugin-style directory:
 *
 *   <root>/<group>/skills/<skill>/SKILL.md
 *   <root>/<group>/commands/<command>.md
 *
 * The Claude Code plugin-marketplace layout. The group travels with each
 * artifact so targets that organise by category can use it, and targets that
 * do not can ignore it.
 */
export class NestedSource implements Source {
  constructor(
    private root: string,
    private dirs: KindDirs = {},
    public name = resolve(root),
  ) {}

  async read(kinds: Kind[]): Promise<Artifact[]> {
    const out: Artifact[] = [];
    let groups;
    try {
      groups = await readdir(this.root, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const g of groups) {
      if (!g.isDirectory() || g.name.startsWith('.')) continue;
      for (const kind of kinds) {
        const sub = this.dirs[kind] ?? DEFAULT_KIND_DIR[kind];
        out.push(...(await readKindDir(kind, join(this.root, g.name, sub), g.name)));
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
}
