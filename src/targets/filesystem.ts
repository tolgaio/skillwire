import { readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Skill } from '../skill.js';
import {
  assertNotInsideSource,
  emptyResult,
  writeSkillTree,
  type InstallOptions,
  type InstallResult,
  type Target,
} from './base.js';

/**
 * Targets that want skills as flat directories of verbatim files:
 *
 *   <skillsDir>/<skill>/SKILL.md
 *
 * Claude Code and pi both work this way, so they differ only in path. Keeping
 * them as one implementation means a fix to copy semantics lands for both.
 */
export class FilesystemTarget implements Target {
  constructor(
    readonly id: string,
    readonly name: string,
    /** Absolute, or relative to $HOME when it starts with ~/ */
    private skillsDir: string,
  ) {}

  private dir(): string {
    return this.skillsDir.startsWith('~/')
      ? join(homedir(), this.skillsDir.slice(2))
      : this.skillsDir;
  }

  async detect(): Promise<boolean> {
    // The parent existing is the signal, not the skills dir itself — an agent
    // that has never had skills installed still has its config directory.
    try {
      return (await stat(join(this.dir(), '..'))).isDirectory();
    } catch {
      return false;
    }
  }

  async install(skills: Skill[], opts: InstallOptions): Promise<InstallResult> {
    const res = emptyResult();
    const root = this.dir();
    await assertNotInsideSource(root, opts.sourceRoot, this.name);

    for (const s of skills) {
      res.wrote.push(await writeSkillTree(s, join(root, s.id), opts.dryRun));
      res.installed.push(s.id);
    }

    if (opts.prune) {
      const keep = new Set(skills.map((s) => s.id));
      let existing: string[] = [];
      try {
        existing = (await readdir(root, { withFileTypes: true }))
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .map((e) => e.name);
      } catch {
        /* nothing installed yet */
      }
      for (const name of existing) {
        if (keep.has(name)) continue;
        if (!opts.dryRun) await rm(join(root, name), { recursive: true, force: true });
        res.skipped.push({ id: name, reason: 'pruned (not in source)' });
      }
    }

    return res;
  }
}

export const claudeCode = () =>
  new FilesystemTarget('claude', 'Claude Code', '~/.claude/skills');

/**
 * pi discovers skills from ~/.pi/agent/skills, ~/.agents/skills, and project
 * -level .pi/skills or .agents/skills. The global agent path is the one that
 * matches "installed for this user".
 */
export const pi = () =>
  new FilesystemTarget('pi', 'pi', '~/.pi/agent/skills');
