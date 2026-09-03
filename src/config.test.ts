import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, saveConfig, type Config } from './config.js';

const wire = (name: string): Config['wires'][number] => ({
  name,
  source: { path: '/tmp' },
  targets: ['claude'],
});

test('overlapping saves all land, and the last one wins', async () => {
  // Two keypresses in quick succession is two saves in flight. Sharing one
  // temp name, the first rename took the file out from under the second, and
  // the second failed on a file that was no longer there.
  const root = await mkdtemp(join(tmpdir(), 'skillwire-cfg-'));
  try {
    const path = join(root, 'c.json');
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => saveConfig({ wires: [wire(`w${i}`)] }, path)),
    );
    const saved = JSON.parse(await readFile(path, 'utf8')) as Config;
    assert.match(saved.wires[0]!.name, /^w\d+$/);
    assert.deepEqual(
      (await readdir(root)).filter((f) => f.endsWith('.tmp')),
      [],
      'no temp files left behind',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a saved config reads back as itself', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillwire-cfg-'));
  try {
    const path = join(root, 'skillwire.config.json');
    const config: Config = {
      wires: [{ ...wire('mine'), prefix: 'p', only: ['skill:a*'], kinds: ['skill'] }],
    };
    await saveConfig(config, path);
    assert.deepEqual((await loadConfig(path)).config, config);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the file is replaced whole, never left half written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillwire-cfg-'));
  try {
    const path = join(root, 'c.json');
    await saveConfig({ wires: Array.from({ length: 200 }, (_, i) => wire(`w${i}`)) }, path);
    await saveConfig({ wires: [wire('small')] }, path);
    const raw = await readFile(path, 'utf8');
    assert.deepEqual(
      (JSON.parse(raw) as Config).wires.map((w) => w.name),
      ['small'],
    );
    assert.ok(raw.endsWith('\n'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
