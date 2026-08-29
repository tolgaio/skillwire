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

async function readKindDir(
  kind: Kind,
  dir: string,
  group?: string,
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
      if (e.isDirectory() && (await isSkillDir(full)))
        out.push(await readSkillDir(full, group));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(await readFileArtifact(kind, full, group));
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
