import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Skill } from '../skill.js';
import { zip } from '../zip.js';
import {
  emptyResult,
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
  private bin: string;
  private workspace?: string;
  private onConflict: string;

  constructor(opts: MulticaOptions = {}) {
    this.bin = opts.bin ?? 'multica';
    this.workspace = opts.workspace;
    this.onConflict = opts.onConflict ?? 'overwrite';
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

  async install(skills: Skill[], opts: InstallOptions): Promise<InstallResult> {
    const res = emptyResult();

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
