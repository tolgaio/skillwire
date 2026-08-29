import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Anything that looks like a credential in a git URL, so it never reaches a
 * log line or an error message.
 *
 * Cloning over https with an embedded token is a common enough setup that a
 * failed clone would otherwise print the token to the terminal — and from
 * there into a scrollback, a CI log, or a bug report.
 */
export function redact(s: string): string {
  return s.replace(/(\b[a-z+]+:\/\/)[^/@\s]*@/gi, '$1***@');
}

/**
 * Turn what a person would write in a config into a URL git can clone.
 *
 *   owner/name              -> https://github.com/owner/name.git
 *   github.com/owner/name   -> https://github.com/owner/name.git
 *   git@host:owner/name.git -> unchanged
 *   https://host/owner/name -> unchanged
 *   /path/to/repo           -> unchanged (a local clone, mostly useful in tests)
 *
 * GitHub is the default host because it is where these repos overwhelmingly
 * live, but nothing else here is GitHub-specific: any URL git accepts works,
 * and authentication is git's own — an SSH key, or a credential helper such as
 * the one `gh auth setup-git` installs. skillwire never handles a token.
 */
export function resolveRepoUrl(spec: string): string {
  const s = spec.trim();
  if (!s) throw new Error('empty git source');
  if (/^([a-z+]+:\/\/|git@|\/|~|\.)/i.test(s)) return s;
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return `https://github.com/${s.replace(/\.git$/, '')}.git`;
  if (/^[\w.-]+\.[\w.-]+\//.test(s)) return `https://${s.replace(/\.git$/, '')}.git`;
  throw new Error(
    `cannot read "${spec}" as a repository. Use owner/name, a host/owner/name path, or a full git URL`,
  );
}

/** A stable, human-legible directory name for a repo URL. */
export function cacheSlug(url: string): string {
  const bare = redact(url)
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^/@]*@/, '')
    .replace(/:/g, '/')
    .replace(/\.git$/, '');
  const slug = bare
    .split('/')
    .filter(Boolean)
    .join('-')
    .replace(/[^\w.-]/g, '-');
  return slug || 'repo';
}

export function cacheRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  return xdg ? join(xdg, 'skillwire', 'repos') : join(homedir(), '.cache', 'skillwire', 'repos');
}

export interface CheckoutOptions {
  /** Contact the remote. When false, an existing clone is used as it stands. */
  fetch?: boolean;
  /** Where clones live. Overridable for tests. */
  root?: string;
  onProgress?: (message: string) => void;
}

export interface Checkout {
  /** Working tree the artifacts are read from. */
  dir: string;
  /** Short commit the tree is at, for display. */
  commit: string;
}

async function git(dir: string | undefined, args: string[]): Promise<string> {
  try {
    // execFile, not a shell: every value here comes from a config file, and a
    // repository name is not a place to invite word splitting.
    const { stdout } = await run('git', args, { cwd: dir, maxBuffer: 32 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(redact((e.stderr || e.message || String(err)).trim().split('\n').slice(-3).join('; ')));
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone or update `url` into the cache and return the checked-out tree.
 *
 * Clones are shallow: skillwire reads the current state of a repo and has no
 * use for its history, and a shallow clone of a large skills repo is the
 * difference between a usable first run and a slow one.
 *
 * The cache is skillwire's own — it resets and cleans the tree on every fetch
 * rather than merging, so a force-push or a changed ref cannot leave a stale
 * artifact behind to be installed.
 */
export async function checkout(
  url: string,
  ref: string | undefined,
  opts: CheckoutOptions = {},
): Promise<Checkout> {
  const root = opts.root ?? cacheRoot();
  const dir = join(root, cacheSlug(url));
  const shown = redact(url);

  if (!(await exists(join(dir, '.git')))) {
    if (opts.fetch === false) {
      throw new Error(`${shown} has never been fetched, so --no-fetch has nothing to read`);
    }
    await mkdir(root, { recursive: true });
    opts.onProgress?.(`cloning ${shown}${ref ? `@${ref}` : ''}`);
    try {
      await git(undefined, ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), url, dir]);
    } catch (err) {
      // --branch takes a branch or a tag, never a commit. Fall back to cloning
      // the default branch and fetching the ref explicitly, which is also the
      // path a commit sha takes.
      if (!ref) throw err;
      await git(undefined, ['clone', '--depth', '1', url, dir]);
      await fetchRef(dir, ref);
    }
  } else if (opts.fetch !== false) {
    opts.onProgress?.(`fetching ${shown}${ref ? `@${ref}` : ''}`);
    await fetchRef(dir, ref);
  }

  return { dir, commit: await git(dir, ['rev-parse', '--short', 'HEAD']) };
}

async function fetchRef(dir: string, ref?: string): Promise<void> {
  try {
    await git(dir, ['fetch', '--depth', '1', 'origin', ref ?? 'HEAD']);
  } catch (err) {
    // A server that refuses to serve an arbitrary commit shallowly is common;
    // deepening is the documented way through, and only costs on that ref.
    if (!ref) throw err;
    await git(dir, ['fetch', 'origin', ref]);
  }
  await git(dir, ['checkout', '--detach', '--force', 'FETCH_HEAD']);
  // Untracked leftovers from a previous ref would otherwise be read as
  // artifacts and installed as if the source still held them.
  await git(dir, ['clean', '-ffd']);
}
