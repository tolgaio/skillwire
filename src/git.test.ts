import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { cacheSlug, checkout, redact, resolveRepoUrl } from './git.js';
import { GitSource } from './sources.js';

const run = promisify(execFile);

test('owner/name is GitHub', () => {
  assert.equal(resolveRepoUrl('owner/name'), 'https://github.com/owner/name.git');
  assert.equal(resolveRepoUrl('owner/name.git'), 'https://github.com/owner/name.git');
});

test('a host/owner/name path names its own host', () => {
  assert.equal(resolveRepoUrl('gitlab.com/o/n'), 'https://gitlab.com/o/n.git');
  assert.equal(resolveRepoUrl('git.example.co.uk/o/n'), 'https://git.example.co.uk/o/n.git');
});

test('a full URL or local path is passed to git untouched', () => {
  for (const u of [
    'https://github.com/o/n.git',
    'ssh://git@host/o/n',
    'git@github.com:o/n.git',
    'file:///srv/repo',
    '/srv/repo',
    '~/src/repo',
  ]) {
    assert.equal(resolveRepoUrl(u), u);
  }
});

test('something that is not a repository is refused, not guessed at', () => {
  assert.throws(() => resolveRepoUrl('just-a-name'), /cannot read/);
  assert.throws(() => resolveRepoUrl('  '), /empty git source/);
});

test('credentials in a URL are redacted', () => {
  // A token in the URL must not reach a terminal, a log, or a bug report.
  assert.equal(
    redact('https://user:ghp_secret@github.com/o/n.git'),
    'https://***@github.com/o/n.git',
  );
  assert.equal(redact('https://ghp_secret@github.com/o/n.git'), 'https://***@github.com/o/n.git');
  // ssh user@host is not a credential and must survive
  assert.equal(redact('git@github.com:o/n.git'), 'git@github.com:o/n.git');
});

test('the cache directory name is legible and carries no credential', () => {
  assert.equal(cacheSlug('https://github.com/owner/name.git'), 'github.com-owner-name');
  assert.equal(cacheSlug('git@github.com:owner/name.git'), 'github.com-owner-name');
  assert.equal(cacheSlug('https://tok@github.com/owner/name.git'), 'github.com-owner-name');
  assert.ok(!cacheSlug('https://user:tok@host/o/n').includes('tok'));
});

/** A real repository, so the git paths are exercised rather than mocked. */
async function repo(): Promise<{ dir: string; commit: (msg: string) => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'skillwire-repo-'));
  await run('git', ['-c', 'init.defaultBranch=main', 'init', '-q', dir]);
  const commit = async (msg: string) => {
    await run('git', ['add', '-A'], { cwd: dir });
    await run(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', msg],
      { cwd: dir },
    );
  };
  return { dir, commit };
}

async function skill(root: string, path: string) {
  await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, path, 'SKILL.md'), `---\nname: ${path.split('/').pop()}\n---\nb\n`);
}

test('clones a repository and reads it exactly as a directory', async () => {
  const { dir, commit } = await repo();
  const cache = await mkdtemp(join(tmpdir(), 'skillwire-cache-'));
  try {
    await skill(dir, 'skills/alpha');
    await skill(dir, '.claude/skills/beta');
    await commit('first');

    const src = new GitSource(dir, undefined, 'auto', {}, [], cache);
    const root = await src.prepare();
    assert.ok(root.startsWith(cache), 'the clone lives in the cache, not beside the source');

    const ids = (await src.read(['skill'])).map((a) => a.id).sort();
    assert.deepEqual(ids, ['alpha', 'claude-beta']);
    assert.match(src.name, /^.*[0-9a-f]{7}/, 'the reported source names the commit read');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});

test('a second run picks up new commits', async () => {
  const { dir, commit } = await repo();
  const cache = await mkdtemp(join(tmpdir(), 'skillwire-cache-'));
  try {
    await skill(dir, 'skills/alpha');
    await commit('first');
    const first = new GitSource(dir, undefined, 'flat', {}, [], cache);
    await first.prepare();
    assert.deepEqual((await first.read(['skill'])).map((a) => a.id), ['alpha']);

    await skill(dir, 'skills/gamma');
    await rm(join(dir, 'skills/alpha'), { recursive: true });
    await commit('second');

    const second = new GitSource(dir, undefined, 'flat', {}, [], cache);
    await second.prepare();
    // The removed skill must be gone from the tree too: left behind, it would
    // be reinstalled as though the source still held it.
    assert.deepEqual((await second.read(['skill'])).map((a) => a.id), ['gamma']);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});

test('a ref pins the source to a branch', async () => {
  const { dir, commit } = await repo();
  const cache = await mkdtemp(join(tmpdir(), 'skillwire-cache-'));
  try {
    await skill(dir, 'skills/alpha');
    await commit('first');
    await run('git', ['checkout', '-q', '-b', 'side'], { cwd: dir });
    await skill(dir, 'skills/side-only');
    await commit('side');
    await run('git', ['checkout', '-q', 'main'], { cwd: dir });

    const src = new GitSource(dir, 'side', 'flat', {}, [], cache);
    await src.prepare();
    const ids = (await src.read(['skill'])).map((a) => a.id).sort();
    assert.deepEqual(ids, ['alpha', 'side-only']);
    assert.match(src.name, /@side/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  }
});

test('--no-fetch with nothing cached says so rather than reading an empty tree', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'skillwire-cache-'));
  try {
    await assert.rejects(
      () => checkout('https://github.com/o/n.git', undefined, { fetch: false, root: cache }),
      /never been fetched/,
    );
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test('a clone failure reports git without leaking the URL credential', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'skillwire-cache-'));
  try {
    await assert.rejects(
      () => checkout('https://u:ghp_secret@127.0.0.1:1/o/n.git', undefined, { root: cache }),
      (err: Error) => {
        assert.ok(!err.message.includes('ghp_secret'), err.message);
        return true;
      },
    );
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});
