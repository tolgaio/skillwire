import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseFrontmatter, type Artifact, type Kind } from '../artifact.js';
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
    assert.match(await readFile(join(root, 'skills/one/SKILL.md'), 'utf8'), /body/);
    assert.match(await readFile(join(root, 'commands/two.md'), 'utf8'), /body/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the installed primary file declares the id as its name', async () => {
  // An artifact installed as work-pdf-export must not claim to be pdf-export: a
  // harness preferring the declared name over the location would otherwise
  // reintroduce the collisions flattening exists to prevent.
  const root = await scratch();
  try {
    const a: Artifact = {
      ...artifact('work-pdf-export'),
      files: [{ path: 'SKILL.md', bytes: Buffer.from('---\nname: pdf-export\ndescription: d\n---\nbody\n') }],
    };
    await target(root).install([a], {});
    const out = await readFile(join(root, 'skills/work-pdf-export/SKILL.md'), 'utf8');
    const { meta } = parseFrontmatter(out);
    assert.equal(meta.name, 'work-pdf-export');
    assert.equal(meta.description, 'd', 'other frontmatter must survive');
    assert.match(out, /body/, 'the body must survive');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('supporting files are copied untouched', async () => {
  const root = await scratch();
  try {
    const bytes = Buffer.from([0x00, 0x01, 0xfe, 0xff]);
    const a: Artifact = {
      ...artifact('one'),
      files: [
        { path: 'SKILL.md', bytes: Buffer.from('---\nname: one\n---\nb\n') },
        { path: 'bin/blob', bytes },
      ],
    };
    await target(root).install([a], {});
    assert.deepEqual(await readFile(join(root, 'skills/one/bin/blob')), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a command file also gets its name rewritten', async () => {
  const root = await scratch();
  try {
    const a: Artifact = {
      ...artifact('team-review', 'command'),
      files: [{ path: 'team-review.md', bytes: Buffer.from('---\nname: review\n---\nb\n') }],
    };
    await target(root).install([a], {});
    const { meta } = parseFrontmatter(
      await readFile(join(root, 'commands/team-review.md'), 'utf8'),
    );
    assert.equal(meta.name, 'team-review');
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
    assert.match(await readFile(join(root, 'skills/one/SKILL.md'), 'utf8'), /v2/);
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

test('prune removes what was installed before and is not installed now', async () => {
  const root = await scratch();
  try {
    const t = target(root);
    await t.install([artifact('keep'), artifact('drop')], {});
    await t.install([artifact('keep')], {
      prune: true,
      previouslyInstalled: ['skill:keep', 'skill:drop'],
    });
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
    await t.install([artifact('keep')], {
      prune: true,
      dryRun: true,
      previouslyInstalled: ['skill:keep', 'skill:drop'],
    });
    assert.deepEqual((await readdir(join(root, 'skills'))).sort(), ['drop', 'keep']);
    // and it says so, rather than reporting a deletion that did not happen
    const res = await t.install([artifact('keep')], {
      prune: true,
      dryRun: true,
      previouslyInstalled: ['skill:keep', 'skill:drop'],
    });
    assert.match(res.skipped[0]!.reason, /^would prune/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prune never touches another wire\'s artifacts', async () => {
  // Each wire's manifest lists only its own ids, so a second wire installing
  // into the same target cannot delete the first wire's work.
  const root = await scratch();
  try {
    const t = target(root);
    await t.install([artifact('alpha-one'), artifact('beta-one')], {});
    await t.install([artifact('alpha-one')], {
      prune: true,
      previouslyInstalled: ['skill:alpha-one'],
    });
    assert.deepEqual((await readdir(join(root, 'skills'))).sort(), ['alpha-one', 'beta-one']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prune reaches artifacts whose ids changed, e.g. after adding a prefix', async () => {
  // The case prefix-scoped pruning could not handle: once a wire gains a
  // prefix, its previously installed ids no longer match, and without a record
  // of them they would be stranded forever.
  const root = await scratch();
  try {
    const t = target(root);
    await t.install([artifact('one'), artifact('two')], {});
    await t.install([artifact('p-one'), artifact('p-two')], {
      prune: true,
      previouslyInstalled: ['skill:one', 'skill:two'],
    });
    assert.deepEqual((await readdir(join(root, 'skills'))).sort(), ['p-one', 'p-two']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prune with no record does nothing', async () => {
  // No manifest entry means skillwire has no idea what it put here, so it
  // removes nothing rather than guessing from the directory listing.
  const root = await scratch();
  try {
    const t = target(root);
    await t.install([artifact('one'), artifact('two')], {});
    await t.install([], { prune: true });
    assert.deepEqual((await readdir(join(root, 'skills'))).sort(), ['one', 'two']);
    // but with a record, an empty source does prune what it used to own
    await t.install([], { prune: true, previouslyInstalled: ['skill:one'] });
    assert.deepEqual(await readdir(join(root, 'skills')), ['two']);
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

test('prune keeps kinds apart', async () => {
  // A skill and a command may share an id. Dropping one from the source must
  // not take the other with it.
  const root = await scratch();
  try {
    const t = target(root);
    await t.install([artifact('deploy'), artifact('deploy', 'command')], {});
    await t.install([artifact('deploy', 'command')], {
      prune: true,
      previouslyInstalled: ['skill:deploy', 'command:deploy'],
    });
    await assert.rejects(() => readdir(join(root, 'skills/deploy')));
    assert.deepEqual(await readdir(join(root, 'commands')), ['deploy.md']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a record for a kind the target does not take is ignored', async () => {
  // pi takes no agents. A manifest entry for one must not send prune looking
  // for a directory the target has no path for.
  const root = await scratch();
  try {
    const t = target(root);
    await t.install([artifact('one')], {});
    await t.install([artifact('one')], { prune: true, previouslyInstalled: ['agent:one'] });
    assert.deepEqual(await readdir(join(root, 'skills')), ['one']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
