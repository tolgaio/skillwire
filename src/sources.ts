import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isSkillDir, readSkill, type Skill } from './skill.js';

export interface Source {
  /** Label used in output. */
  name: string;
  read(): Promise<Skill[]>;
}

/**
 * Skills as direct children of a directory:
 *
 *   <root>/<skill>/SKILL.md
 *
 * The common layout — anthropics/skills and most public skill repos.
 */
export class FlatSource implements Source {
  constructor(
    private root: string,
    public name = resolve(root),
  ) {}

  async read(): Promise<Skill[]> {
    const out: Skill[] = [];
    for (const e of await readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dir = join(this.root, e.name);
      if (await isSkillDir(dir)) out.push(await readSkill(dir));
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
}

/**
 * Skills nested one level under a grouping directory:
 *
 *   <root>/<group>/skills/<skill>/SKILL.md
 *
 * The Claude Code plugin-marketplace layout, e.g. a repo with
 * plugins/<plugin>/skills/<skill>. The group is carried on each skill so
 * targets that organise by category (hermes) can use it, and targets that do
 * not (claude, pi, multica) can ignore it.
 */
export class NestedSource implements Source {
  constructor(
    private root: string,
    private inner = 'skills',
    public name = resolve(root),
  ) {}

  async read(): Promise<Skill[]> {
    const out: Skill[] = [];
    for (const g of await readdir(this.root, { withFileTypes: true })) {
      if (!g.isDirectory() || g.name.startsWith('.')) continue;
      const groupDir = join(this.root, g.name, this.inner);
      let entries;
      try {
        entries = await readdir(groupDir, { withFileTypes: true });
      } catch {
        continue; // a group without a skills/ dir is normal, not an error
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const dir = join(groupDir, e.name);
        if (await isSkillDir(dir)) out.push(await readSkill(dir, g.name));
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }
}

/**
 * Detect which layout a repo uses.
 *
 * Checks for skills as direct children first, then a plugin-style nesting.
 * Returns null when neither matches, so callers can report it rather than
 * silently installing nothing.
 */
export async function detectSource(root: string): Promise<Source | null> {
  const flat = new FlatSource(root);
  if ((await flat.read()).length > 0) return flat;

  for (const sub of ['skills', 'plugins']) {
    const dir = join(root, sub);
    try {
      const s = sub === 'skills' ? new FlatSource(dir) : new NestedSource(dir);
      if ((await s.read()).length > 0) return s;
    } catch {
      /* not this layout */
    }
  }
  return null;
}
