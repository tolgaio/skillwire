import { rm, stat } from 'node:fs/promises';
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

    // Prune has to visit kinds the source no longer produces at all — dropping
    // the last skill from a wire must still remove the skills it left behind —
    // so the loop covers every kind with either current or recorded artifacts.
    const previously = new Map<Kind, string[]>();
    for (const entry of opts.previouslyInstalled ?? []) {
      const [kind, ...rest] = entry.split(':');
      if (!this.kinds.includes(kind as Kind)) continue;
      previously.set(kind as Kind, [...(previously.get(kind as Kind) ?? []), rest.join(':')]);
    }

    for (const kind of new Set([...byKind.keys(), ...previously.keys()])) {
      const group = byKind.get(kind) ?? [];
      const root = this.dir(kind);
      await assertNotInsideSource(root, opts.sourceRoot, `${this.name} ${kind}s`);

      for (const a of group) {
        result.wrote.push(await writeArtifact(a, root, opts.dryRun));
        result.installed.push(`${kind}:${a.id}`);
      }

      if (opts.prune) {
        // Remove what this wire installed last time and is not installing now.
        // Reading the directory instead would sweep up other wires' work and
        // anything installed by hand.
        const keep = new Set(group.map((a) => a.id));
        for (const id of previously.get(kind) ?? []) {
          if (keep.has(id)) continue;
          const name = isDirKind(kind) ? id : `${id}.md`;
          const path = join(root, name);
          try {
            await stat(path);
          } catch {
            continue; // already gone
          }
          if (!opts.dryRun) await rm(path, { recursive: true, force: true });
          result.skipped.push({
            id: `${kind}:${id}`,
            reason: opts.dryRun ? 'would prune (no longer in source)' : 'pruned (no longer in source)',
          });
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
