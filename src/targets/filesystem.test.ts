import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Artifact, Kind } from '../artifact.js';
import { assertNotInsideSource, partitionByKind } from './base.js';
import { FilesystemTarget } from './filesystem.js';

const artifact = (id: string, kind: Kind = 'skill', body = 'body'): Artifact => ({
  kind,
  id,
  name: id,
  description: '',
  body,
  raw: body,
  files:
    kind === 'skill'
      ? [{ path: 'SKILL.md', bytes: Buffer.from(body) }]
      : [{ path: `${id}.md`, bytes: Buffer.from(body) }],
  meta: {},
  path: `/src/${id}`,
});

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skillwire-fs-'));
}

function target(root: string): FilesystemTarget {
  return new FilesystemTarget('test', 'Test', {
    skill: join(root, 'skills'),
    command: join(root, 'commands'),
  });
}

test('installs skills as directories and commands as files', async () => {
  const root = await scratch();
  try {
    await target(root).install([artifact('one'), artifact('two', 'command')], {});
    assert.equal(await readFile(join(root, 'skills/one/SKILL.md'), 'utf8'), 'body');
    assert.equal(await readFile(join(root, 'commands/two.md'), 'utf8'), 'body');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('kinds the target does not take are reported, not dropped silently', async () => {
  const root = await scratch();
  try {
    const res = await target(root).install([artifact('a', 'agent')], {});
    assert.equal(res.installed.length, 0);
    assert.equal(res.skipped.length, 1);
    assert.match(res.skipped[0]!.reason, /takes no agents/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unsupported kinds are aggregated, one line per kind', async () => {
  // 238 commands wired at a target that takes none should produce one line.
  const many = Array.from({ length: 50 }, (_, i) => artifact(`c${i}`, 'agent'));
  const { result } = partitionByKind(many, ['skill'], 'Test');
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0]!.id, /^50 agents$/);
});

test('reinstalling replaces rather than merging', async () => {
  const root = await scratch();
  try {
    const t = target(root);
    const withExtra: Artifact = {
      ...artifact('one'),
      files: [
        { path: 'SKILL.md', bytes: Buffer.from('v1') },
        { path: 'gone.sh', bytes: Buffer.from('x') },
      ],
    };
    await t.install([withExtra], {});
    assert.ok((await readdir(join(root, 'skills/one'))).includes('gone.sh'));

    // the source drops a file; the stale copy must not survive, or an agent
    // would still read it
    await t.install([artifact('one', 'skill', 'v2')], {});
    const files = await readdir(join(root, 'skills/one'));
    assert.deepEqual(files, ['SKILL.md']);
    assert.equal(await readFile(join(root, 'skills/one/SKILL.md'), 'utf8'), 'v2');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dry run writes nothing', async () => {
  const root = await scratch();
  try {
    const res = await target(root).install([artifact('one')], { dryRun: true });
    assert.equal(res.installed.length, 1);
    await assert.rejects(() => readdir(join(root, 'skills')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prune removes what is absent from the source', async () => {
  const root = await scratch();
  try {
    const t = target(root);
    await t.install([artifact('keep'), artifact('drop')], {});
    await t.install([artifact('keep')], { prune: true });
    assert.deepEqual(await readdir(join(root, 'skills')), ['keep']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prune leaves everything alone in a dry run', async () => {
  const root = await scratch();
  try {
    const t = target(root);
    await t.install([artifact('keep'), artifact('drop')], {});
    await t.install([artifact('keep')], { prune: true, dryRun: true });
    assert.deepEqual((await readdir(join(root, 'skills'))).sort(), ['drop', 'keep']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pruneScope confines prune to one namespace', async () => {
  // Two wires installing into one target: each knows only its own artifacts, so
  // an unscoped prune would have the second delete the first's work.
  const root = await scratch();
  try {
    const t = target(root);
    await t.install([artifact('alpha-one'), artifact('beta-one')], {});
    await t.install([artifact('alpha-one')], { prune: true, pruneScope: 'alpha-' });
    assert.deepEqual((await readdir(join(root, 'skills'))).sort(), ['alpha-one', 'beta-one']);

    // and within its own namespace it still prunes
    await t.install([artifact('alpha-two')], { prune: true, pruneScope: 'alpha-' });
    assert.deepEqual((await readdir(join(root, 'skills'))).sort(), ['alpha-two', 'beta-one']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an empty source does not prune', async () => {
  // Deliberate. Prune runs per kind, over the kinds the source produced, so a
  // source that yields nothing removes nothing. A misconfigured path is far
  // more likely than a genuine intent to delete everything, and the failure
  // modes are not comparable.
  const root = await scratch();
  try {
    const t = target(root);
    await t.install([artifact('one'), artifact('two')], {});
    await t.install([], { prune: true });
    assert.deepEqual((await readdir(join(root, 'skills'))).sort(), ['one', 'two']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses to install into its own source', async () => {
  const root = await scratch();
  try {
    await mkdir(join(root, 'repo/skills'), { recursive: true });
    await assert.rejects(
      () => assertNotInsideSource(join(root, 'repo/skills'), join(root, 'repo'), 'Test'),
      /refusing to install/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refuses even when the target reaches the source through a symlink', async () => {
  // The conventional setup — ~/.claude/skills symlinked at the repo — is
  // exactly this shape, and installing would rewrite the repo in place.
  const root = await scratch();
  try {
    await mkdir(join(root, 'repo/skills'), { recursive: true });
    await mkdir(join(root, 'home'), { recursive: true });
    await symlink(join(root, 'repo/skills'), join(root, 'home/skills'));
    await assert.rejects(
      () => assertNotInsideSource(join(root, 'home/skills'), join(root, 'repo'), 'Test'),
      /refusing to install/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('allows an unrelated target directory', async () => {
  const root = await scratch();
  try {
    await mkdir(join(root, 'repo'), { recursive: true });
    await mkdir(join(root, 'elsewhere'), { recursive: true });
    await assertNotInsideSource(join(root, 'elsewhere'), join(root, 'repo'), 'Test');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('allows a target that does not exist yet', async () => {
  const root = await scratch();
  try {
    await mkdir(join(root, 'repo'), { recursive: true });
    await assertNotInsideSource(join(root, 'not/created/yet'), join(root, 'repo'), 'Test');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('no source root means no containment check', async () => {
  await assertNotInsideSource('/anywhere', undefined, 'Test');
});
