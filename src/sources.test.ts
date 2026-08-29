import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { DirectorySource, FlatSource, NestedSource, idPrefix } from './sources.js';

let root: string;

async function skill(path: string, name = path.split('/').pop()!) {
  await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, path, 'SKILL.md'), `---\nname: ${name}\n---\nbody\n`);
}

async function file(path: string, body = 'x') {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), body);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'skillwire-src-'));

  // flat skills
  await skill('skills/alpha');
  await skill('skills/beta');
  // one level down — a collection, not a skill itself
  await skill('skills/coll/one');
  await skill('skills/coll/two');
  // two levels down
  await skill('skills/deep/mid/leaf');
  // a directory that is not a skill and contains none
  await mkdir(join(root, 'skills/notaskill'), { recursive: true });
  await writeFile(join(root, 'skills/notaskill/README.md'), 'no SKILL.md here');
  // hidden things are ignored
  await skill('skills/.hidden');

  await file('commands/review.md');
  await file('commands/nested/deploy.md');
  await file('commands/notmarkdown.txt');
  await file('agents/reviewer.md');

  // plugin-marketplace layout
  await skill('plugins/tools/skills/style-guide');
  await file('plugins/tools/commands/publish.md');
  await skill('plugins/web/skills/build');
  await mkdir(join(root, 'plugins/empty'), { recursive: true });
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test('flat: finds skills at every depth, ids are the path', async () => {
  const ids = (await new FlatSource(root).read(['skill'])).map((a) => a.id).sort();
  assert.deepEqual(ids, ['alpha', 'beta', 'coll-one', 'coll-two', 'deep-mid-leaf']);
});

test('flat: a directory with no skills below it contributes nothing', async () => {
  const ids = (await new FlatSource(root).read(['skill'])).map((a) => a.id);
  assert.ok(!ids.some((i) => i.startsWith('notaskill')));
});

test('flat: hidden directories are skipped', async () => {
  const ids = (await new FlatSource(root).read(['skill'])).map((a) => a.id);
  assert.ok(!ids.some((i) => i.includes('hidden')));
});

test('flat: commands and agents are single files, ids drop the extension', async () => {
  const src = new FlatSource(root);
  assert.deepEqual((await src.read(['command'])).map((a) => a.id).sort(), [
    'nested-deploy',
    'review',
  ]);
  assert.deepEqual((await src.read(['agent'])).map((a) => a.id), ['reviewer']);
});

test('flat: non-markdown files are not commands', async () => {
  const ids = (await new FlatSource(root).read(['command'])).map((a) => a.id);
  assert.ok(!ids.includes('notmarkdown'));
});

test('reading several kinds returns them all, tagged', async () => {
  const got = await new FlatSource(root).read(['skill', 'command', 'agent']);
  const byKind = new Map<string, number>();
  for (const a of got) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  assert.equal(byKind.get('skill'), 5);
  assert.equal(byKind.get('command'), 2);
  assert.equal(byKind.get('agent'), 1);
});

test('a missing kind directory is not an error', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'skillwire-empty-'));
  try {
    assert.deepEqual(await new FlatSource(empty).read(['skill', 'command', 'agent']), []);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test('nested: groups become the group field, not part of the id', async () => {
  const got = await new NestedSource(join(root, 'plugins')).read(['skill']);
  assert.deepEqual(
    got.map((a) => [a.id, a.group]).sort(),
    [
      ['build', 'web'],
      ['style-guide', 'tools'],
    ],
  );
});

test('nested: reads other kinds from the same group', async () => {
  const got = await new NestedSource(join(root, 'plugins')).read(['command']);
  assert.deepEqual(got.map((a) => [a.id, a.group]), [['publish', 'tools']]);
});

test('nested: a group with no kind directories is skipped', async () => {
  const got = await new NestedSource(join(root, 'plugins')).read(['skill', 'command', 'agent']);
  assert.ok(!got.some((a) => a.group === 'empty'));
});

test('artifacts carry their files, with paths relative to the artifact', async () => {
  await writeFile(join(root, 'skills/alpha/helper.sh'), '#!/bin/sh\n');
  await mkdir(join(root, 'skills/alpha/lib'), { recursive: true });
  await writeFile(join(root, 'skills/alpha/lib/util.py'), 'x = 1\n');

  const alpha = (await new FlatSource(root).read(['skill'])).find((a) => a.id === 'alpha')!;
  assert.deepEqual(alpha.files.map((f) => f.path).sort(), [
    'SKILL.md',
    'helper.sh',
    'lib/util.py',
  ]);
});

test('results are stable in order', async () => {
  const once = (await new FlatSource(root).read(['skill'])).map((a) => a.id);
  const twice = (await new FlatSource(root).read(['skill'])).map((a) => a.id);
  assert.deepEqual(once, twice);
});

// --- auto layout and scan paths ------------------------------------------
//
// These get their own tree: the shared one above is deliberately a single
// known layout, and auto exists for repos that are not.

let mixed: string;

before(async () => {
  mixed = await mkdtemp(join(tmpdir(), 'skillwire-auto-'));
  const put = async (p: string) => {
    await mkdir(join(mixed, p), { recursive: true });
    await writeFile(join(mixed, p, 'SKILL.md'), `---\nname: ${p.split('/').pop()}\n---\nb\n`);
  };
  const md = async (p: string) => {
    await mkdir(join(mixed, p, '..'), { recursive: true });
    await writeFile(join(mixed, p), 'x');
  };

  await put('skills/root-level');
  await put('.claude/skills/dotted');
  await put('plugins/tools/skills/style-guide');
  await put('packages/web/.claude/skills/build');
  await md('.claude/commands/review.md');
  await md('plugins/tools/agents/proofreader.md');

  // a skill that ships its own commands/ directory: those are the skill's
  // files, not the repo's commands
  await put('skills/bundled');
  await md('skills/bundled/commands/helper.md');

  // never walked into
  await put('node_modules/pkg/skills/vendored');
  await mkdir(join(mixed, '.git/skills/nope'), { recursive: true });
  await writeFile(join(mixed, '.git/skills/nope/SKILL.md'), '---\nname: nope\n---\n');

  // two scan paths holding the same-named skill
  await put('teams/a/skills/deploy');
  await put('teams/b/skills/deploy');
});

after(async () => {
  await rm(mixed, { recursive: true, force: true });
});

const auto = (paths: string[] = []) => new DirectorySource(mixed, 'auto', {}, paths);

test('auto: finds kind directories wherever they are', async () => {
  const ids = (await auto().read(['skill'])).map((a) => a.id).sort();
  assert.deepEqual(ids, [
    'bundled',
    'claude-dotted',
    'packages-web-claude-build',
    'plugins-tools-style-guide',
    'root-level',
    'teams-a-deploy',
    'teams-b-deploy',
  ]);
});

test('auto: ids carry the path, so same-named skills do not collide', async () => {
  const ids = (await auto().read(['skill'])).map((a) => a.id);
  assert.ok(ids.includes('teams-a-deploy') && ids.includes('teams-b-deploy'));
});

test('auto: a directory at the root contributes an unprefixed id', async () => {
  // The common case must not become more verbose just because auto is on.
  const ids = (await auto().read(['skill'])).map((a) => a.id);
  assert.ok(ids.includes('root-level'));
});

test('auto: a skill\'s own subdirectories are its files, not the repo\'s artifacts', async () => {
  const ids = (await auto().read(['command'])).map((a) => a.id).sort();
  assert.deepEqual(ids, ['claude-review']);
  const bundled = (await auto().read(['skill'])).find((a) => a.id === 'bundled')!;
  assert.ok(bundled.files.some((f) => f.path === 'commands/helper.md'));
});

test('auto: .git and node_modules are never walked', async () => {
  const ids = (await auto().read(['skill'])).map((a) => a.id);
  assert.ok(!ids.some((i) => i.includes('vendored') || i.includes('nope')));
});

test('auto: reads every kind in one pass', async () => {
  const got = await auto().read(['skill', 'command', 'agent']);
  assert.deepEqual(
    got.filter((a) => a.kind === 'agent').map((a) => a.id),
    ['plugins-tools-proofreader'],
  );
});

test('paths: only the listed subdirectories are scanned', async () => {
  const ids = (await auto(['plugins']).read(['skill'])).map((a) => a.id);
  assert.deepEqual(ids, ['plugins-tools-style-guide']);
});

test('paths: ids stay relative to the root, so adding a path renames nothing', async () => {
  const all = (await auto().read(['skill'])).map((a) => a.id);
  const some = (await auto(['plugins', 'teams']).read(['skill'])).map((a) => a.id);
  assert.ok(some.every((i) => all.includes(i)));
  assert.deepEqual(some.sort(), ['plugins-tools-style-guide', 'teams-a-deploy', 'teams-b-deploy']);
});

test('paths: overlapping paths do not double-read', async () => {
  const ids = (await auto(['.', 'plugins']).read(['skill'])).map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('paths: work with an explicit layout too', async () => {
  const src = new DirectorySource(mixed, 'flat', {}, ['teams/a', 'teams/b']);
  assert.deepEqual((await src.read(['skill'])).map((a) => a.id).sort(), [
    'teams-a-deploy',
    'teams-b-deploy',
  ]);
});

test('paths: a path climbing out of the source is refused', async () => {
  // Otherwise a config could read and publish arbitrary files from the machine.
  for (const bad of ['../elsewhere', 'a/../../b', '/etc', '~/secrets']) {
    await assert.rejects(() => auto([bad]).read(['skill']), /must be inside the source/);
  }
});

test('idPrefix drops leading dots and empty segments', () => {
  assert.equal(idPrefix(''), '');
  assert.equal(idPrefix('.'), '');
  assert.equal(idPrefix('.claude'), 'claude-');
  assert.equal(idPrefix('a/b'), 'a-b-');
});

test('a source directory that does not exist is an error, not an empty read', async () => {
  // Silently reading zero artifacts from a typo is how a --prune run removes
  // everything a wire installed.
  await assert.rejects(
    () => new DirectorySource(join(mixed, 'no-such-dir')).prepare(),
    /not a directory/,
  );
});
