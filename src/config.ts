import { readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
  DirectorySource,
  GitSource,
  type KindDirs,
  type Layout,
  type Source,
} from './sources.js';
import type { Kind } from './artifact.js';
import type { Target } from './targets/base.js';
import { claudeCode, pi } from './targets/filesystem.js';
import { hermes } from './targets/hermes.js';
import { multica } from './targets/multica.js';

export interface SourceConfig {
  /** A directory on this machine. Mutually exclusive with `git`. */
  path?: string;
  /**
   * A repository to clone: `owner/name` for GitHub, or any URL git accepts.
   *
   * Authentication is git's own — an SSH key, or a credential helper such as
   * the one `gh auth setup-git` installs. skillwire never handles a token.
   */
  git?: string;
  /** Branch, tag or commit to read. Defaults to the repo's default branch. */
  ref?: string;
  /**
   * flat   <root>/<kindDir>/...
   * nested <root>/<group>/<kindDir>/...   (Claude Code plugin marketplaces)
   * auto   kind directories are found wherever they are in the tree
   *
   * Defaults to `flat` for a local path and `auto` for a repo: a directory you
   * maintain has a layout you know, and one you are pointing at may not.
   */
  layout?: Layout;
  /** Override the subdirectory for a kind, e.g. { "command": "prompts" }. */
  dirs?: KindDirs;
  /**
   * Subdirectories to scan, relative to the source root. Omit to scan the root.
   *
   * Ids stay relative to the root either way, so adding a path never renames
   * anything else, and two paths that each hold a `deploy` skill produce two
   * distinct ids rather than one overwriting the other.
   */
  paths?: string[];
}

export type TargetConfig = string | ({ id: string } & Record<string, unknown>);

export interface Wire {
  name: string;
  source: SourceConfig;
  targets: TargetConfig[];
  /** Which kinds to wire. Defaults to all of them. */
  kinds?: Kind[];
  /**
   * Prepended to every id from this wire, as `<prefix>-<id>`.
   *
   * Ids are unique within a source but not across sources — two repos can each
   * hold a `pdf-export` skill, and without a prefix the second wire installed
   * silently overwrites the first. A prefix namespaces a whole source.
   *
   * Applied after `only`/`exclude`, so filters match the id as it appears in
   * the repo rather than the prefixed form.
   */
  prefix?: string;
  /** Install only ids matching these patterns. `*` is a wildcard. Omit for all. */
  only?: string[];
  /** Never install ids matching these patterns. `*` is a wildcard. */
  exclude?: string[];
}

export interface Config {
  wires: Wire[];
}

export function expandPath(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(p);
}

export function buildSource(cfg: SourceConfig): Source {
  if (cfg.git && cfg.path) {
    throw new Error('a source has either "path" or "git", not both');
  }
  if (cfg.git) {
    return new GitSource(cfg.git, cfg.ref, cfg.layout ?? 'auto', cfg.dirs ?? {}, cfg.paths ?? []);
  }
  if (!cfg.path) throw new Error('a source needs either "path" or "git"');
  if (cfg.ref) throw new Error('"ref" only applies to a "git" source');
  return new DirectorySource(
    expandPath(cfg.path),
    cfg.layout ?? 'flat',
    cfg.dirs ?? {},
    cfg.paths ?? [],
    cfg.path,
  );
}

/** Every target id `buildTarget` knows, for menus and error messages. */
export const TARGET_IDS = ['claude', 'pi', 'hermes', 'multica'] as const;

export function buildTarget(cfg: TargetConfig): Target {
  const { id, ...opts } = typeof cfg === 'string' ? { id: cfg } : cfg;
  switch (id) {
    case 'claude':
      return claudeCode();
    case 'pi':
      return pi();
    case 'hermes':
      return hermes(opts as Parameters<typeof hermes>[0]);
    case 'multica':
      return multica(opts as Parameters<typeof multica>[0]);
    default:
      throw new Error(`unknown target "${id}" (known: ${TARGET_IDS.join(', ')})`);
  }
}

export const CONFIG_NAMES = ['skillwire.config.json', '.skillwire.json'];

export async function loadConfig(explicit?: string): Promise<{ config: Config; path: string }> {
  const candidates = explicit
    ? [expandPath(explicit)]
    : [
        ...CONFIG_NAMES.map((n) => resolve(n)),
        ...CONFIG_NAMES.map((n) => join(homedir(), '.config', 'skillwire', n)),
      ];

  for (const p of candidates) {
    try {
      const raw = await readFile(p, 'utf8');
      const config = JSON.parse(raw) as Config;
      if (!Array.isArray(config.wires))
        throw new Error(`${p}: expected a "wires" array`);
      return { config, path: p };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }
  throw new Error(
    `no config found (looked for ${CONFIG_NAMES.join(', ')} here and in ~/.config/skillwire)`,
  );
}

/**
 * Write the config back, atomically.
 *
 * The interactive picker saves after every change, so a crash or a full disk
 * mid-write must not be able to leave a half-written config — that file is the
 * only record of what each wire installs. Writing beside the target and
 * renaming makes the replacement a single step.
 */
let writes = 0;

export async function saveConfig(config: Config, path: string): Promise<void> {
  // A counter as well as the pid. Two saves overlap the moment someone presses
  // two keys quickly: sharing one temp name, the first rename takes the file
  // out from under the second, which then fails on a file that is no longer
  // there. Every write gets its own.
  const tmp = `${path}.${process.pid}.${writes++}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}
