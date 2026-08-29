import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Artifact, Kind } from '../artifact.js';
import { zip } from '../zip.js';
import {
  partitionByKind,
  type InstallOptions,
  type InstallResult,
  type Target,
} from './base.js';

const run = promisify(execFile);

export interface MulticaOptions {
  /** Path to the multica CLI. */
  bin?: string;
  /**
   * Workspace to install into. The CLI is scoped to whichever workspace the
   * profile points at, so installing into a different one means switching
   * first. Left unset, skills land in the currently configured workspace.
   */
  workspace?: string;
  /** fail | overwrite | rename | skip. Overwrite is what re-running a sync wants. */
  onConflict?: 'fail' | 'overwrite' | 'rename' | 'skip';
  /**
   * Runtime to create agents on, by name as shown in `multica runtime list`
   * (e.g. "Claude (ship)"). Required to wire agents: --runtime-id is mandatory
   * on `agent create` and is a workspace-specific UUID, so it cannot come from
   * the agent file. Without it, agents are skipped rather than guessed at.
   */
  agentRuntime?: string;
}

/**
 * Multica — the target that is not a filesystem.
 *
 * Skills live in Postgres and are reached through an HTTP API, so installing
 * means packaging each skill and uploading it:
 *
 *   multica skill import --file <zip> --on-conflict overwrite
 *
 * Two things worth knowing about this path.
 *
 * `skill import --url` also exists and records an origin, which makes
 * `skill refresh` possible later. It is not used here because the import is
 * performed server-side: the multica backend fetches the URL itself, so it only
 * works for repos the backend can read. For a private repo that means giving
 * the backend GitHub credentials. Uploading the bytes needs no such thing,
 * which is the whole reason the push model works for private skill repos.
 *
 * The trade-off is that a --file import records no origin, so `skill refresh`
 * cannot re-pull it. Re-running skillwire is the refresh.
 */
export class MulticaTarget implements Target {
  readonly id = 'multica';
  readonly name = 'Multica';
  readonly kinds: Kind[] = ['skill', 'agent'];
  private bin: string;
  private workspace?: string;
  private onConflict: string;
  private agentRuntime?: string;

  constructor(opts: MulticaOptions = {}) {
    this.bin = opts.bin ?? 'multica';
    this.workspace = opts.workspace;
    this.onConflict = opts.onConflict ?? 'overwrite';
    this.agentRuntime = opts.agentRuntime;
  }

  async detect(): Promise<boolean> {
    try {
      await run(this.bin, ['version']);
      return true;
    } catch {
      return false;
    }
  }

  /** Which workspace is the CLI currently pointed at, if it will tell us. */
  private async currentWorkspace(): Promise<string | null> {
    try {
      const { stdout } = await run(this.bin, ['workspace', 'list', '--output', 'json']);
      const list = JSON.parse(stdout) as { id: string; name: string; current?: boolean }[];
      return list.find((w) => w.current)?.name ?? null;
    } catch {
      return null;
    }
  }

  /** Resolve a runtime name to its id. */
  private async runtimeId(name: string): Promise<string | null> {
    try {
      const { stdout } = await run(this.bin, ['runtime', 'list', '--output', 'json']);
      const list = JSON.parse(stdout) as { id: string; name: string }[];
      return list.find((r) => r.name === name)?.id ?? null;
    } catch {
      return null;
    }
  }

  private async existingAgent(name: string): Promise<string | null> {
    try {
      const { stdout } = await run(this.bin, ['agent', 'list', '--output', 'json']);
      const list = JSON.parse(stdout) as { id: string; name: string }[];
      return list.find((a) => a.name === name)?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Wire agent .md files to `agent create` / `agent update`.
   *
   * Only the fields the file actually describes are sent: name, description and
   * instructions. Runtime, model, MCP servers, environment and skill
   * assignments are deliberately left alone on update, because those are set in
   * the UI and are not expressible in an agent file — passing them would mean
   * silently reverting choices skillwire did not make. The runtime is supplied
   * only on create, where it is mandatory.
   *
   * Claude's `tools:` frontmatter has no multica equivalent and is dropped.
   */
  private async installAgents(
    agents: Artifact[],
    opts: InstallOptions,
    res: InstallResult,
  ): Promise<void> {
    if (!this.agentRuntime) {
      for (const a of agents)
        res.skipped.push({
          id: `agent:${a.id}`,
          reason: 'no agentRuntime configured (--runtime-id is required to create agents)',
        });
      return;
    }

    let runtimeId: string | null = null;

    for (const a of agents) {
      const existing = opts.dryRun ? null : await this.existingAgent(a.name);
      try {
        if (existing) {
          if (!opts.dryRun)
            await run(this.bin, [
              'agent', 'update', existing,
              '--description', a.description,
              '--instructions', a.body,
              '--output', 'json',
            ]);
          res.installed.push(`agent:${a.id} (updated)`);
        } else {
          if (!opts.dryRun) {
            runtimeId ??= await this.runtimeId(this.agentRuntime);
            if (!runtimeId) {
              res.skipped.push({
                id: `agent:${a.id}`,
                reason: `runtime "${this.agentRuntime}" not found in this workspace`,
              });
              continue;
            }
            await run(this.bin, [
              'agent', 'create',
              '--name', a.name,
              '--runtime-id', runtimeId,
              '--description', a.description,
              '--instructions', a.body,
              '--output', 'json',
            ]);
          }
          res.installed.push(`agent:${a.id} (created)`);
        }
        res.wrote.push(`${this.id}:agent:${a.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.skipped.push({ id: `agent:${a.id}`, reason: msg.split('\n')[0] ?? 'failed' });
      }
    }
  }

  async install(artifacts: Artifact[], opts: InstallOptions): Promise<InstallResult> {
    const { accepted, result: res } = partitionByKind(artifacts, this.kinds, this.name);
    const skills = accepted.filter((a) => a.kind === 'skill');
    const agents = accepted.filter((a) => a.kind === 'agent');

    if (this.workspace) {
      const current = await this.currentWorkspace();
      if (current && current !== this.workspace) {
        if (opts.dryRun) {
          res.skipped.push({
            id: '*',
            reason: `would switch workspace ${current} -> ${this.workspace}`,
          });
        } else {
          // Switching changes the default workspace for the whole profile,
          // which the local daemon also reads. Callers should be explicit about
          // wanting that rather than having it happen as a side effect.
          await run(this.bin, ['workspace', 'switch', this.workspace]);
        }
      }
    }

    if (agents.length) await this.installAgents(agents, opts, res);

    const tmp = await mkdtemp(join(tmpdir(), 'skillwire-'));
    try {
      for (const s of skills) {
        const archive = join(tmp, `${s.id}.zip`);
        if (opts.dryRun) {
          res.installed.push(s.id);
          res.wrote.push(`${this.id}:${s.id}`);
          continue;
        }

        await writeFile(
          archive,
          zip(s.files.map((f) => ({ path: f.path, bytes: f.bytes }))),
        );

        try {
          await run(this.bin, [
            'skill',
            'import',
            '--file',
            archive,
            '--on-conflict',
            this.onConflict,
            '--output',
            'json',
          ]);
          res.installed.push(s.id);
          res.wrote.push(`${this.id}:${s.id}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // One failing skill should not abandon the rest of the batch.
          res.skipped.push({ id: s.id, reason: msg.split('\n')[0] ?? 'import failed' });
        }
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }

    if (opts.prune) {
      // Deliberately not implemented. Pruning here would delete skills from a
      // shared workspace that other people may have created through the UI, and
      // multica skills carry agent assignments that a delete would discard.
      res.skipped.push({
        id: '*',
        reason: 'prune not supported for multica (would delete shared, agent-assigned skills)',
      });
    }

    return res;
  }
}

export const multica = (opts?: MulticaOptions) => new MulticaTarget(opts);
