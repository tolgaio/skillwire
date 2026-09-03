import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Config } from './config.js';
import { run } from './run.js';
import { stripAnsi } from './style.js';

/**
 * run() end to end, against a real filesystem target.
 *
 * HOME and XDG_STATE_HOME are redirected at a temp directory, so the claude
 * target writes there and the manifest lives there too — a test that installed
 * into the real ~/.claude would be worse than no test.
 */

let root: string;
let src: string;
let savedHome: string | undefined;
let savedState: string | undefined;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'skillwire-run-'));
  src = join(root, 'src');
  savedHome = process.env.HOME;
  savedState = process.env.XDG_STATE_HOME;
  process.env.HOME = join(root, 'home');
  process.env.XDG_STATE_HOME = join(root, 'state');
  await mkdir(join(root, 'home', '.claude'), { recursive: true });
});

after(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedState;
  await rm(root, { recursive: true, force: true });
});

async function skill(id: string): Promise<void> {
  await mkdir(join(src, 'skills', id), { recursive: true });
  await writeFile(join(src, 'skills', id, 'SKILL.md'), `---\nname: ${id}\n---\nbody\n`);
}

const config = (): Config => ({
  wires: [{ name: 'w', source: { path: src }, targets: ['claude'] }],
});

async function install(opts = {}): Promise<string> {
  const lines: string[] = [];
  await run(config(), { prune: true, ...opts }, (l) => lines.push(l));
  return lines.map(stripAnsi).join('\n');
}

test('the first install names what it added', async () => {
  await skill('alpha');
  await skill('beta');
  const out = await install();
  assert.match(out, /2 installed\s+2 new/);
  assert.match(out, /\+ skill:alpha/);
  assert.match(out, /\+ skill:beta/);
});

test('a run that changes nothing says so by saying nothing', async () => {
  const out = await install();
  assert.match(out, /2 installed/);
  assert.doesNotMatch(out, /new/);
  assert.doesNotMatch(out, /\+ skill:/);
});

test('adding one names that one, and not the two already there', async () => {
  // The question after ticking a box is "did that one arrive?", and a count
  // that goes from 2 to 3 does not answer it.
  await skill('gamma');
  const out = await install();
  assert.match(out, /3 installed\s+1 new/);
  assert.match(out, /\+ skill:gamma/);
  assert.doesNotMatch(out, /\+ skill:alpha/);
});

test('removing one names what was pruned', async () => {
  await rm(join(src, 'skills', 'beta'), { recursive: true });
  const out = await install();
  assert.match(out, /2 installed/);
  assert.match(out, /skill:beta: pruned/);
  assert.doesNotMatch(out, /new/);
});

test('a dry run reports the same additions without recording them', async () => {
  await skill('delta');
  const dry = await install({ dryRun: true });
  assert.match(dry, /would/);
  assert.match(dry, /\+ skill:delta/);

  // nothing was recorded, so the real run still reports it as new
  const real = await install();
  assert.match(real, /\+ skill:delta/);
});

test('a long list of additions is capped rather than filling the screen', async () => {
  for (let i = 0; i < 25; i++) await skill(`bulk-${String(i).padStart(2, '0')}`);
  const out = await install();
  assert.match(out, /25 new/);
  assert.equal(out.split('\n').filter((l) => l.includes('+ skill:bulk-')).length, 20);
  assert.match(out, /… and 5 more/);
});
