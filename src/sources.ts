import { readdir, stat } from 'node:fs/promises';
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
import { checkout, redact, resolveRepoUrl } from './git.js';

export interface PrepareOptions {
  /** Contact the network. False uses whatever is already cached. */
  fetch?: boolean;
  onProgress?: (message: string) => void;
}

export interface Source {
  name: string;
  /**
   * Make the source readable and return the local directory it lives in.
   *
   * A local source has nothing to do; a git source clones or updates. Targets
   * need the returned path to refuse installing into their own source, so this
   * is separate from read() rather than hidden inside it.
   */
  prepare(opts?: PrepareOptions): Promise<string>;
  /** Read every artifact of the given kinds. */
  read(kinds: Kind[]): Promise<Artifact[]>;
}

/** Per-kind subdirectory names, relative to the source root. */
export type KindDirs = Partial<Record<Kind, string>>;

/**
 * flat   <root>/<kindDir>/...
 * nested <root>/<group>/<kindDir>/...   (Claude Code plugin marketplaces)
 * auto   the kind directories are found wherever they are
 */
export type Layout = 'flat' | 'nested' | 'auto';

/** How deep `auto` looks for a kind directory before giving up. */
const AUTO_DEPTH = 5;

/** Directories never worth walking into. */
const SKIP = new Set(['.git', 'node_modules']);

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
 * The id prefix contributed by a path within the source.
 *
 * Ids are always relative to the source root, never to a scan path, so adding
 * or removing an entry in `paths` never renames anything else — and two scan
 * paths that each hold a `deploy` skill produce two distinct ids instead of
 * one silently overwriting the other.
 *
 * Leading dots are dropped, so .claude/skills/review becomes claude-review
 * rather than something starting with a dash.
 */
export function idPrefix(rel: string): string {
  const parts = rel
    .split('/')
    .map((p) => p.replace(/^\.+/, ''))
    .filter((p) => p && p !== '.');
  return parts.length ? `${parts.join('-')}-` : '';
}

/** A scan path that climbs out of the source would read arbitrary files. */
function assertWithinRoot(rel: string): string {
  const clean = rel.replace(/^\.\//, '').replace(/\/+$/, '');
  if (clean.startsWith('/') || clean.startsWith('~') || clean.split('/').includes('..')) {
    throw new Error(`source path "${rel}" must be inside the source, and relative to its root`);
  }
  return clean;
}

interface KindRoot {
  kind: Kind;
  /** Directory holding the artifacts. */
  dir: string;
  /** Path from the source root to that directory's parent. */
  rel: string;
}

/**
 * Find the kind directories anywhere under `from`.
 *
 * A repository you point at is not necessarily a repository you laid out:
 * skills turn up at the root, under .claude/, and one per plugin, sometimes all
 * three at once. Rather than making people declare which, `auto` looks.
 *
 * The walk stops at a kind directory and never enters a skill, so a skill that
 * happens to contain a `commands/` directory of its own contributes nothing —
 * those are its files, not the repo's commands.
 */
async function discover(
  from: string,
  root: string,
  names: Map<string, Kind>,
  depth = 0,
): Promise<KindRoot[]> {
  let entries;
  try {
    entries = await readdir(from, { withFileTypes: true });
  } catch {
    return [];
  }

  const rel = from === root ? '' : from.slice(root.length + 1);
  const out: KindRoot[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    const full = join(from, e.name);
    const kind = names.get(e.name);
    if (kind) {
      out.push({ kind, dir: full, rel });
      continue; // readKindDir owns everything below here
    }
    if (depth >= AUTO_DEPTH) continue;
    if (await isSkillDir(full)) continue;
    out.push(...(await discover(full, root, names, depth + 1)));
  }
  return out;
}

/**
 * A source that is a directory on this machine.
 *
 * Both a local path and a cloned repo end up here: once a repo is on disk it
 * is just a directory, so ids, filtering, prefixes and prune all behave
 * identically whichever way the files arrived.
 */
export class DirectorySource implements Source {
  constructor(
    protected root: string,
    private layout: Layout = 'flat',
    private dirs: KindDirs = {},
    private paths: string[] = [],
    public name = resolve(root),
  ) {}

  async prepare(): Promise<string> {
    try {
      if ((await stat(this.root)).isDirectory()) return this.root;
    } catch {
      /* fall through to the shared message */
    }
    // Worth failing over rather than reading as empty: a mistyped path is
    // otherwise indistinguishable from a repo with nothing in it, and with
    // --prune the difference is everything this wire installed.
    throw new Error(`source is not a directory: ${this.root}`);
  }

  private dirFor(kind: Kind): string {
    return this.dirs[kind] ?? DEFAULT_KIND_DIR[kind];
  }

  async read(kinds: Kind[]): Promise<Artifact[]> {
    const scans = (this.paths.length ? this.paths : ['']).map(assertWithinRoot);
    const out: Artifact[] = [];
    for (const scan of scans) {
      const base = scan ? join(this.root, scan) : this.root;
      out.push(...(await this.readOne(base, scan, kinds)));
    }

    // Overlapping scan paths can reach the same directory twice. Ids encode the
    // path from the root, so a duplicate id is the same artifact, not a clash.
    const seen = new Set<string>();
    return out
      .filter((a) => !seen.has(`${a.kind}:${a.id}`) && seen.add(`${a.kind}:${a.id}`))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  }

  private async readOne(base: string, scan: string, kinds: Kind[]): Promise<Artifact[]> {
    const out: Artifact[] = [];

    if (this.layout === 'auto') {
      const names = new Map<string, Kind>();
      for (const kind of kinds) names.set(this.dirFor(kind), kind);
      for (const found of await discover(base, base, names)) {
        const rel = [scan, found.rel].filter(Boolean).join('/');
        const group = found.rel ? found.rel.split('/').pop() : undefined;
        out.push(...(await readKindDir(found.kind, found.dir, group, idPrefix(rel))));
      }
      return out;
    }

    if (this.layout === 'nested') {
      let groups;
      try {
        groups = await readdir(base, { withFileTypes: true });
      } catch {
        return out;
      }
      for (const g of groups) {
        if (!g.isDirectory() || g.name.startsWith('.')) continue;
        for (const kind of kinds) {
          const dir = join(base, g.name, this.dirFor(kind));
          out.push(...(await readKindDir(kind, dir, g.name, idPrefix(scan))));
        }
      }
      return out;
    }

    for (const kind of kinds) {
      out.push(...(await readKindDir(kind, join(base, this.dirFor(kind)), undefined, idPrefix(scan))));
    }
    return out;
  }
}

/**
 * A repo holding each kind in its own subdirectory:
 *
 *   <root>/skills/<skill>/SKILL.md
 *   <root>/commands/<command>.md
 *   <root>/agents/<agent>.md
 */
export class FlatSource extends DirectorySource {
  constructor(root: string, dirs: KindDirs = {}, name = resolve(root), paths: string[] = []) {
    super(root, 'flat', dirs, paths, name);
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
export class NestedSource extends DirectorySource {
  constructor(root: string, dirs: KindDirs = {}, name = resolve(root), paths: string[] = []) {
    super(root, 'nested', dirs, paths, name);
  }
}

/**
 * A source that lives in a git repository.
 *
 * It clones into skillwire's cache and then reads the working tree exactly as
 * a local directory is read — the repo is a way of getting the files, not a
 * different kind of source. Everything downstream is unchanged.
 */
export class GitSource implements Source {
  private inner?: DirectorySource;
  readonly url: string;

  constructor(
    spec: string,
    private ref: string | undefined,
    private layout: Layout,
    private dirs: KindDirs = {},
    private paths: string[] = [],
    private cache?: string,
  ) {
    this.url = resolveRepoUrl(spec);
  }

  /** Set once prepared, so the reported source says which commit was read. */
  name = '';

  async prepare(opts: PrepareOptions = {}): Promise<string> {
    const { dir, commit } = await checkout(this.url, this.ref, {
      fetch: opts.fetch,
      root: this.cache,
      onProgress: opts.onProgress,
    });
    this.name = `${redact(this.url).replace(/^https:\/\//, '').replace(/\.git$/, '')}${
      this.ref ? `@${this.ref}` : ''
    } ${commit}`;
    this.inner = new DirectorySource(dir, this.layout, this.dirs, this.paths, this.name);
    return dir;
  }

  async read(kinds: Kind[]): Promise<Artifact[]> {
    if (!this.inner) await this.prepare();
    return this.inner!.read(kinds);
  }
}
