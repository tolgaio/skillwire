import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  manifestPath,
  previouslyInstalled,
  readManifest,
  record,
  writeManifest,
  type Manifest,
} from './manifest.js';

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skillwire-manifest-'));
}

test('a missing manifest reads as empty rather than failing', async () => {
  // First ever run. Prune must degrade to a no-op, not an error.
  const m = await readManifest('/nonexistent/skillwire/manifest.json');
  assert.deepEqual(m, { version: 1, wires: {} });
  assert.deepEqual(previouslyInstalled(m, 'any', 'claude'), []);
});

test('a corrupt manifest reads as empty', async () => {
  const root = await scratch();
  try {
    const p = join(root, 'manifest.json');
    await writeFile(p, 'not json at all');
    assert.deepEqual(await readManifest(p), { version: 1, wires: {} });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a manifest from a future version is ignored, not acted on', async () => {
  // Acting on a shape we do not understand risks deleting the wrong things, so
  // an unknown version degrades prune to a no-op.
  const root = await scratch();
  try {
    const p = join(root, 'manifest.json');
    await writeFile(p, JSON.stringify({ version: 2, wires: { w: { claude: ['skill:x'] } } }));
    assert.deepEqual(await readManifest(p), { version: 1, wires: {} });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('round-trips through disk', async () => {
  const root = await scratch();
  try {
    const p = join(root, 'nested', 'manifest.json');
    const m = record({ version: 1, wires: {} }, 'personal', 'claude', ['skill:b', 'skill:a']);
    await writeManifest(m, p);
    assert.deepEqual(await readManifest(p), m);
    // sorted on write, so a reordered source produces no diff
    assert.deepEqual(JSON.parse(await readFile(p, 'utf8')).wires.personal.claude, [
      'skill:a',
      'skill:b',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('record replaces one wire+target without touching the others', async () => {
  let m: Manifest = { version: 1, wires: {} };
  m = record(m, 'personal', 'claude', ['skill:a']);
  m = record(m, 'personal', 'multica', ['skill:b']);
  m = record(m, 'work', 'claude', ['skill:c']);
  m = record(m, 'personal', 'claude', ['skill:d']);

  assert.deepEqual(previouslyInstalled(m, 'personal', 'claude'), ['skill:d']);
  assert.deepEqual(previouslyInstalled(m, 'personal', 'multica'), ['skill:b']);
  assert.deepEqual(previouslyInstalled(m, 'work', 'claude'), ['skill:c']);
});

test('an unrecorded wire or target has nothing installed', async () => {
  const m = record({ version: 1, wires: {} }, 'personal', 'claude', ['skill:a']);
  assert.deepEqual(previouslyInstalled(m, 'personal', 'pi'), []);
  assert.deepEqual(previouslyInstalled(m, 'other', 'claude'), []);
});

test('the manifest lives under XDG_STATE_HOME when it is set', () => {
  const before = process.env.XDG_STATE_HOME;
  try {
    process.env.XDG_STATE_HOME = '/xdg/state';
    assert.equal(manifestPath(), '/xdg/state/skillwire/manifest.json');
    delete process.env.XDG_STATE_HOME;
    assert.match(manifestPath(), /\.local\/state\/skillwire\/manifest\.json$/);
  } finally {
    if (before === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = before;
  }
});
