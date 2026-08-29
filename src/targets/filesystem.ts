import { readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDirKind, type Artifact, type Kind } from '../artifact.js';
import {
  assertNotInsideSource,
  emptyResult,
  partitionByKind,
  writeArtifact,
  type InstallOptions,
  type InstallResult,
  type Target,
} from './base.js';

/** Where each kind lives, relative to $HOME when it starts with ~/ */
export type KindPaths = Partial<Record<Kind, string>>;

/**
 * Targets that store artifacts as files on disk, one directory per kind.
 *
 * Claude Code and pi differ only in their paths and in which kinds they
 * support, so they share this implementation — a fix to copy or prune
 * semantics lands for both.
 */
export class FilesystemTarget implements Target {
  readonly kinds: Kind[];

  constructor(
    readonly id: string,
    readonly name: string,
    private paths: KindPaths,
  ) {
    this.kinds = Object.keys(paths) as Kind[];
  }

  private dir(kind: Kind): string {
    const p = this.paths[kind]!;
    return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
  }

  async detect(): Promise<boolean> {
    // The parent existing is the signal: an agent that has never had artifacts
    // installed still has its config directory.
    for (const kind of this.kinds) {
      try {
        if ((await stat(join(this.dir(kind), '..'))).isDirectory()) return true;
      } catch {
        /* try the next kind */
      }
    }
    return false;
  }

  async install(artifacts: Artifact[], opts: InstallOptions): Promise<InstallResult> {
    const { accepted, result } = partitionByKind(artifacts, this.kinds, this.name);

    const byKind = new Map<Kind, Artifact[]>();
    for (const a of accepted) byKind.set(a.kind, [...(byKind.get(a.kind) ?? []), a]);

    for (const [kind, group] of byKind) {
      const root = this.dir(kind);
      await assertNotInsideSource(root, opts.sourceRoot, `${this.name} ${kind}s`);

      for (const a of group) {
        result.wrote.push(await writeArtifact(a, root, opts.dryRun));
        result.installed.push(`${kind}:${a.id}`);
      }

      if (opts.prune) {
        const keep = new Set(group.map((a) => (isDirKind(kind) ? a.id : `${a.id}.md`)));
        let existing: string[] = [];
        try {
          existing = (await readdir(root, { withFileTypes: true }))
            .filter((e) => (isDirKind(kind) ? e.isDirectory() : e.isFile()))
            .filter((e) => !e.name.startsWith('.'))
            .map((e) => e.name);
        } catch {
          /* nothing installed yet */
        }
        for (const name of existing) {
          if (keep.has(name)) continue;
          if (!opts.dryRun) await rm(join(root, name), { recursive: true, force: true });
          result.skipped.push({ id: `${kind}:${name}`, reason: 'pruned (not in source)' });
        }
      }
    }

    return result;
  }
}

export const claudeCode = () =>
  new FilesystemTarget('claude', 'Claude Code', {
    skill: '~/.claude/skills',
    command: '~/.claude/commands',
    agent: '~/.claude/agents',
  });

/**
 * pi discovers skills from ~/.pi/agent/skills and prompt templates — its
 * equivalent of commands, invoked as /name — from ~/.pi/agent/prompts.
 *
 * It has no separate notion of subagent definition files, so agents are not
 * wired here rather than being written somewhere pi would ignore.
 */
export const pi = () =>
  new FilesystemTarget('pi', 'pi', {
    skill: '~/.pi/agent/skills',
    command: '~/.pi/agent/prompts',
  });
