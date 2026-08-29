import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Artifact, Kind } from '../artifact.js';
import {
  assertNotInsideSource,
  partitionByKind,
  writeArtifact,
  type InstallOptions,
  type InstallResult,
  type Target,
} from './base.js';

export interface HermesOptions {
  /**
   * Where hermes keeps skills. Defaults to ~/.hermes/skills.
   *
   * When hermes runs in a container it is usually started with
   * `-v ~/.hermes:/opt/data` and HERMES_HOME=/opt/data, so the host path is
   * still the right thing to write to — the mount makes them the same place.
   */
  skillsDir?: string;
  /** Category for skills that arrive without a group. */
  defaultCategory?: string;
}

/**
 * Hermes Agent.
 *
 * Same SKILL.md format as everything else, but one grouping level deeper:
 *
 *   <skillsDir>/<category>/<skill>/SKILL.md
 *   <skillsDir>/<category>/DESCRIPTION.md
 *
 * The category is taken from the skill's source group when it has one (a
 * plugin-nested repo gives you that for free), otherwise from defaultCategory.
 *
 * Hermes ships its own curated categories — apple, github, research and so on.
 * This target only ever touches categories it is installing into, and prune is
 * likewise scoped to those, so bundled skills are never disturbed.
 */
export class HermesTarget implements Target {
  readonly id = 'hermes';
  readonly name = 'Hermes Agent';
  /** Hermes has its own catalogue of skills only; no commands or agents on disk. */
  readonly kinds: Kind[] = ['skill'];
  private skillsDir: string;
  private defaultCategory: string;

  constructor(opts: HermesOptions = {}) {
    this.skillsDir = opts.skillsDir ?? join(homedir(), '.hermes', 'skills');
    this.defaultCategory = opts.defaultCategory ?? 'custom';
  }

  async detect(): Promise<boolean> {
    try {
      return (await stat(join(this.skillsDir, '..'))).isDirectory();
    } catch {
      return false;
    }
  }

  private category(s: Artifact): string {
    return s.group ?? this.defaultCategory;
  }

  async install(artifacts: Artifact[], opts: InstallOptions): Promise<InstallResult> {
    const { accepted: skills, result: res } = partitionByKind(artifacts, this.kinds, this.name);
    if (skills.length) await assertNotInsideSource(this.skillsDir, opts.sourceRoot, this.name);
    const byCategory = new Map<string, Artifact[]>();
    for (const s of skills) {
      const c = this.category(s);
      byCategory.set(c, [...(byCategory.get(c) ?? []), s]);
    }

    for (const [category, group] of byCategory) {
      const catDir = join(this.skillsDir, category);
      if (!opts.dryRun) await mkdir(catDir, { recursive: true });

      for (const s of group) {
        res.wrote.push(await writeArtifact(s, catDir, opts.dryRun));
        res.installed.push(`${category}/${s.id}`);
      }

      // Hermes reads DESCRIPTION.md to summarise a category. Write one only if
      // absent: a hand-written description is better than anything generated
      // from skill names, and clobbering it on every run would be rude.
      const descPath = join(catDir, 'DESCRIPTION.md');
      const exists = await stat(descPath).then(
        () => true,
        () => false,
      );
      if (!exists && !opts.dryRun) {
        const names = group.map((s) => s.name).join(', ');
        await writeFile(
          descPath,
          `---\ndescription: ${names}\n---\n`,
          'utf8',
        );
        res.wrote.push(descPath);
      }

      if (opts.prune) {
        const keep = new Set(group.map((s) => s.id));
        let existing: string[] = [];
        try {
          existing = (await readdir(catDir, { withFileTypes: true }))
            .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
            .map((e) => e.name);
        } catch {
          /* new category */
        }
        for (const name of existing) {
          if (keep.has(name)) continue;
          if (!opts.dryRun)
            await rm(join(catDir, name), { recursive: true, force: true });
          res.skipped.push({ id: `${category}/${name}`, reason: 'pruned (not in source)' });
        }
      }
    }

    return res;
  }
}

export const hermes = (opts?: HermesOptions) => new HermesTarget(opts);
