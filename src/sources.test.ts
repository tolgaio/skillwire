import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { FlatSource, NestedSource } from './sources.js';

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
