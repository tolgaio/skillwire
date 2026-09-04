import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { render } from 'ink-testing-library';
import type { Config, Wire } from '../config.js';
import type { RunOptions } from '../run.js';
import { App } from './App.js';
import { MARKS } from './components/List.js';
import { MouseProvider } from './mouse.js';
import { StoreProvider } from './store.js';

/**
 * The picker, driven through Ink's own test renderer.
 *
 * `stdin.write` sends what a terminal would send and `lastFrame()` is what it
 * would show, so these exercise the real component tree — layout, focus and
 * input handling included — rather than a model of it.
 */

const ESC = String.fromCharCode(27);
const KEY = {
  up: `${ESC}[A`,
  down: `${ESC}[B`,
  left: `${ESC}[D`,
  right: `${ESC}[C`,
  enter: '\r',
  escape: ESC,
  tab: '\t',
  ctrlS: String.fromCharCode(19),
};

const tick = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** What a change should produce, for `saved()` to wait on. */
const has = (field: 'only' | 'exclude') => (c: Config): boolean => !!c.wires[0]?.[field];
const clean = (c: Config): boolean => !c.wires[0]?.only && !c.wires[0]?.exclude;

async function fixture(over: Partial<Wire> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'skillwire-ink-'));
  const src = join(root, 'src');
  for (const [id, description] of [
    ['alpha', 'The first skill'],
    ['beta', 'The second skill'],
    ['gamma', 'The third skill'],
  ]) {
    await mkdir(join(src, 'skills', id!), { recursive: true });
    await writeFile(
      join(src, 'skills', id!, 'SKILL.md'),
      `---\nname: ${id}\ndescription: ${description}\n---\nbody\n`,
    );
  }
  const path = join(root, 'skillwire.config.json');
  const config: Config = {
    wires: [{ name: 'mine', source: { path: src }, targets: ['claude'], ...over }],
  };
  await writeFile(path, JSON.stringify(config, null, 2));

  const runs: RunOptions[] = [];
  const app = render(
    <MouseProvider>
      <StoreProvider
        initialConfig={config}
        configPath={path}
        noFetch
        runner={async (_c, opts, log) => {
          runs.push(opts);
          log('  ok    claude  3 installed');
          return 0;
        }}
      >
        <App />
      </StoreProvider>
    </MouseProvider>,
  );
  await tick(140); // the first read of the source

  return {
    root,
    src,
    runs,
    screen: (): string => app.lastFrame() ?? '',
    /**
     * Send keys, and wait for the screen to finish reacting.
     *
     * A fixed pause after a keystroke is a race on a loaded machine: the
     * assertion reads the frame from before the render and reports the feature
     * as broken. Waiting for the frame to stop changing is what a person
     * looking at the terminal does.
     */
    press: async (...keys: string[]) => {
      for (const k of keys) {
        app.stdin.write(k);
        await tick(10);
        let last = '';
        for (let i = 0, still = 0; i < 80 && still < 3; i++) {
          const frame = app.lastFrame() ?? '';
          still = frame === last ? still + 1 : 0;
          last = frame;
          await tick(10);
        }
      }
    },

    /** Wait for something to appear on screen, then assert it did. */
    expect: async (pattern: RegExp, why?: string): Promise<void> => {
      for (let i = 0; i < 200 && !pattern.test(app.lastFrame() ?? ''); i++) await tick(15);
      assert.match(app.lastFrame() ?? '', pattern, why);
    },
    /**
     * The config on disk.
     *
     * Saving is asynchronous, so reading a fixed moment after a keypress is a
     * race — and it is lost by reading the previous state, which looks exactly
     * like the feature not working. Pass what the change should produce and
     * this waits for it; polling for the file merely to stop changing cannot
     * tell "finished" from "not started".
     */
    saved: async (want?: (c: Config) => boolean): Promise<Config> => {
      let last = JSON.parse(await readFile(path, 'utf8')) as Config;
      for (let i = 0; want && !want(last) && i < 200; i++) {
        await tick(15);
        last = JSON.parse(await readFile(path, 'utf8')) as Config;
      }
      return last;
    },
    done: () => app.unmount(),
  };
}

test('the source list shows each source, where it comes from and how much is selected', async () => {
  const f = await fixture();
  try {
    const s = f.screen();
    assert.match(s, /skillwire/);
    assert.match(s, /mine/);
    assert.match(s, /3\/3/, 'everything selected by default');
    assert.match(s, /claude/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('browsing lists artifacts with their descriptions', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter);
    const s = f.screen();
    assert.match(s, /alpha/);
    assert.match(s, /The first skill/, 'the description is what makes the list useful');
    assert.match(s, new RegExp(MARKS.on), 'everything starts ticked');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('unticking writes the config immediately', async () => {
  // The file is the only state the picker has: quitting and running install
  // must do exactly what the screen said.
  const f = await fixture();
  try {
    await f.press(KEY.enter, ' ');
    assert.deepEqual((await f.saved(has('exclude'))).wires[0]!.exclude, ['skill:alpha']);
    assert.match(f.screen(), /2 of 3 selected/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('ticking it back leaves no filter behind', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter, ' ', ' ');
    const saved = await f.saved(clean);
    assert.equal(saved.wires[0]!.exclude, undefined);
    assert.equal(saved.wires[0]!.only, undefined);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('hjkl moves like the arrows do', async () => {
  const f = await fixture();
  try {
    await f.press('l');
    assert.match(f.screen(), /The first skill/);
    await f.press('j', ' ');
    assert.deepEqual((await f.saved(has('exclude'))).wires[0]!.exclude, ['skill:beta']);
    await f.press('k', ' ');
    assert.deepEqual((await f.saved(has('only'))).wires[0]!.only, ['skill:gamma']);
    await f.press('h');
    assert.match(f.screen(), /SELECTED/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('G and g jump to the ends', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter, 'G', ' ');
    assert.deepEqual((await f.saved(has('exclude'))).wires[0]!.exclude, ['skill:gamma']);
    await f.press('g', ' ');
    assert.deepEqual((await f.saved(has('only'))).wires[0]!.only, ['skill:beta']);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('arrow keys do the same as hjkl', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.right, KEY.down, ' ');
    assert.deepEqual((await f.saved(has('exclude'))).wires[0]!.exclude, ['skill:beta']);
    await f.press(KEY.left);
    assert.match(f.screen(), /SELECTED/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('s narrows the list to what is selected, then to what is not', async () => {
  // A source of five hundred is not reviewable by scrolling; the question
  // anyone has is "what did I pick?".
  const f = await fixture();
  try {
    await f.press(KEY.enter, ' ');
    await f.press('s');
    await f.expect(/showing selected/);
    assert.match(f.screen(), /beta/);
    assert.doesNotMatch(f.screen(), new RegExp(`${MARKS.on} alpha`));

    await f.press('s');
    await f.expect(/showing unselected/);
    assert.match(f.screen(), /alpha/);
    assert.doesNotMatch(f.screen(), new RegExp(`${MARKS.on} gamma`));

    await f.press('s');
    assert.doesNotMatch(f.screen(), /showing (selected|unselected)/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('bulk keys act on what the list is showing, not the whole source', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter, ' ');
    await f.press('s', 's');
    await f.press('a');
    const saved = await f.saved(clean);
    assert.equal(saved.wires[0]!.exclude, undefined);
    assert.equal(saved.wires[0]!.only, undefined);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the picker refuses to leave a source with nothing selected', async () => {
  const f = await fixture({ only: ['skill:alpha'] });
  try {
    await f.press(KEY.enter, ' ');
    await f.expect(/installs nothing/);
    assert.deepEqual((await f.saved()).wires[0]!.only, ['skill:alpha'], 'unchanged');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('ticking something a pattern excludes just works, and keeps the pattern', async () => {
  // Fiddling with filters to get one skill out of an excluded collection is
  // not an interaction anyone wants. The tick names it; the pattern stands.
  const f = await fixture({ exclude: ['skill:b*'] });
  try {
    await f.press(KEY.enter, 'j', ' ');
    const saved = await f.saved((c) => !!c.wires[0]!.include);
    assert.deepEqual(saved.wires[0]!.include, ['skill:beta']);
    assert.deepEqual(saved.wires[0]!.exclude, ['skill:b*'], 'the pattern is untouched');
    await f.expect(/include skill:beta/, 'the strip says an include is in play');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a glob typed in the filter editor is kept as a glob', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter, 'f', 'x');
    for (const ch of 'skill:b*') await f.press(ch);
    await f.press(KEY.enter);
    assert.deepEqual((await f.saved(has('exclude'))).wires[0]!.exclude, ['skill:b*']);
    await f.expect(/1 match/, 'the editor says what a pattern catches');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('turning off a kind stops it being read at all', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter, 'K', ' ');
    assert.deepEqual((await f.saved((c) => !!c.wires[0]!.kinds)).wires[0]!.kinds, ['command', 'agent']);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('i installs with --prune, because the ticks are what should be installed', async () => {
  // An install that only ever added would leave everything you unticked in
  // place, and the checkboxes would describe nothing.
  const f = await fixture();
  try {
    await f.press(KEY.enter, 'i');
    await tick(140);
    assert.deepEqual(f.runs, [{ wires: ['mine'], dryRun: false, prune: true, noFetch: true }]);
    assert.match(f.screen(), /with --prune/);
    await f.expect(/3 installed/, 'the output streams into the UI');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('D previews the same run, deletions included', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter, 'D');
    await tick(140);
    assert.equal(f.runs[0]!.dryRun, true);
    assert.equal(f.runs[0]!.prune, true);
    await f.expect(/nothing was written/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('? opens a key list over the current screen, and any key closes it', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter, '?');
    const s = f.screen();
    assert.match(s, /tick, or open a folder/);
    assert.match(s, /show all \/ selected \/ unselected/);
    assert.match(s, /page up \/ down/, 'the global keys are listed too');
    await f.press(KEY.escape);
    assert.doesNotMatch(f.screen(), /tick, or open a folder/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the breadcrumb says where you are', async () => {
  const f = await fixture();
  try {
    assert.match(f.screen(), /skillwire\s+›\s+sources/);
    await f.press(KEY.enter);
    assert.match(f.screen(), /sources\s+›\s+mine/);
    await f.press('f');
    assert.match(f.screen(), /mine\s+›\s+filters/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('escape steps back out one screen at a time', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter);
    assert.match(f.screen(), /The first skill/);
    await f.press('f');
    assert.match(f.screen(), /› filters/);
    await f.press(KEY.escape);
    assert.match(f.screen(), /The first skill/);
    await f.press(KEY.escape);
    assert.match(f.screen(), /SELECTED/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a source added in the form lands in the config in the shape the CLI reads', async () => {
  const f = await fixture();
  try {
    await f.press('a');
    for (const ch of 'second') await f.press(ch); // typing works straight away
    await f.press(KEY.enter, KEY.enter); // past Name and Source kind
    for (const ch of f.src) await f.press(ch);
    await f.press(KEY.ctrlS);
    await tick(140);

    const saved = await f.saved((c) => c.wires.length === 2);
    assert.equal(saved.wires.length, 2);
    assert.equal(saved.wires[1]!.name, 'second');
    assert.equal(saved.wires[1]!.source.path, f.src);
    assert.deepEqual(saved.wires[1]!.targets, ['claude']);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a duplicate name is refused, since --wire matches on it', async () => {
  const f = await fixture();
  try {
    await f.press('a');
    for (const ch of 'mine') await f.press(ch);
    await f.press(KEY.enter, KEY.enter);
    for (const ch of f.src) await f.press(ch);
    await f.press(KEY.ctrlS);
    await tick(100);
    await f.expect(/already a wire "mine"/);
    assert.equal((await f.saved()).wires.length, 1);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('escape leaves the form without writing anything', async () => {
  const f = await fixture();
  try {
    await f.press('a');
    for (const ch of 'ghost') await f.press(ch);
    await f.press(KEY.escape);
    assert.equal((await f.saved()).wires.length, 1);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('deleting asks first, and says what it does not do', async () => {
  const f = await fixture();
  try {
    await f.press('d');
    assert.match(f.screen(), /Delete "mine"\?/);
    assert.match(f.screen(), /--prune/, 'it must be clear that files are left behind');
    await f.press('n');
    assert.equal((await f.saved()).wires.length, 1);

    await f.press('d', 'y');
    assert.equal((await f.saved((c) => !c.wires.length)).wires.length, 0);
    await f.expect(/No sources yet/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a source that cannot be read is reported, not treated as empty', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillwire-ink-'));
  try {
    const path = join(root, 'c.json');
    const config: Config = {
      wires: [{ name: 'gone', source: { path: join(root, 'missing') }, targets: ['claude'] }],
    };
    await writeFile(path, JSON.stringify(config));
    const app = render(
      <MouseProvider>
        <StoreProvider initialConfig={config} configPath={path} noFetch>
          <App />
        </StoreProvider>
      </MouseProvider>,
    );
    await tick(140);
    assert.match(app.lastFrame() ?? '', /not a directory/);
    app.unmount();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- mouse ----------------------------------------------------------------
//
// Clicks arrive as escape sequences at a screen position, so these assert the
// whole path: the terminal's report, the region measured by Ink's layout, and
// the action it lands on.

/** What a terminal sends for a left click at a 1-based cell. */
const clickAt = (column: number, row: number): string =>
  `${ESC}[<0;${column};${row}M${ESC}[<0;${column};${row}m`;

/** Find the 1-based screen row a piece of text is drawn on. */
function rowOf(screen: string, needle: string | RegExp): number {
  const lines = screen.split('\n');
  const at = lines.findIndex((l) =>
    typeof needle === 'string' ? l.includes(needle) : needle.test(l),
  );
  assert.notEqual(at, -1, `"${needle}" is not on screen:\n${screen}`);
  return at + 1;
}

/**
 * The row a given artifact's marker is on.
 *
 * By the marker, not the description: the side panel prints the description of
 * the row under the cursor, on the same screen lines as the list beside it, so
 * searching for the text finds whichever line the panel happened to put it.
 */
const marked = (id: string): RegExp => new RegExp(`[${MARKS.on}${MARKS.off}] ${id}`);
const rowFor = (screen: string, id: string): number => rowOf(screen, marked(id));

test('clicking a skill ticks it', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter);
    await f.press(clickAt(10, rowFor(f.screen(), 'beta')));
    assert.deepEqual((await f.saved(has('exclude'))).wires[0]!.exclude, ['skill:beta']);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('clicking the same skill again unticks it', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter);
    const at = rowFor(f.screen(), 'gamma');
    await f.press(clickAt(10, at), clickAt(10, at));
    const saved = await f.saved(clean);
    assert.equal(saved.wires[0]!.exclude, undefined);
    assert.equal(saved.wires[0]!.only, undefined);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a mouse report never reaches a screen as keystrokes', async () => {
  // `[<0;1;1M` would otherwise be read as a bracket, a less-than, digits and
  // an M — several commands from one click.
  const f = await fixture();
  try {
    await f.press(KEY.enter);
    const before = await f.saved();
    await f.press(`${ESC}[<0;1;1M`); // the header, which nothing owns
    assert.deepEqual(await f.saved(), before, 'nothing was triggered');
    assert.match(f.screen(), /The first skill/, 'and we are still on the list');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('clicking a breadcrumb goes back to it', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter, 'f');
    assert.match(f.screen(), /› filters/);
    const line = f.screen().split('\n')[1]!;
    await f.press(clickAt(line.indexOf('sources') + 2, 2));
    assert.match(f.screen(), /SELECTED/, 'back at the source list');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('clicking a key in the footer presses it', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter);
    const screen = f.screen();
    const at = rowOf(screen, 'showing');
    const column = screen.split('\n')[at - 1]!.indexOf('s showing') + 1;
    await f.press(clickAt(column, at));
    await f.expect(/showing selected/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the wheel scrolls the list without changing anything', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter);
    const before = await f.saved();
    await f.press(`${ESC}[<65;10;${rowFor(f.screen(), 'alpha')}M`);
    assert.deepEqual(await f.saved(), before, 'scrolling is not selecting');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('m turns the mouse off, and says why you would want to', async () => {
  const f = await fixture();
  try {
    await f.press('m');
    await f.expect(/selects text again/);
    await f.press(KEY.enter);
    const before = await f.saved();
    await f.press(clickAt(10, rowFor(f.screen(), 'beta')));
    assert.deepEqual(await f.saved(), before, 'clicks do nothing once it is off');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the list does not shift under the pointer when a filter appears', async () => {
  // Ticking the first artifact adds a filter badge. If the bar that shows it
  // appears only then, every row moves down one and a second click lands on
  // the wrong skill.
  const f = await fixture();
  try {
    await f.press(KEY.enter);
    const before = rowFor(f.screen(), 'gamma');
    await f.press(clickAt(10, before));
    assert.equal(rowFor(f.screen(), 'gamma'), before, f.screen());
    await f.press(clickAt(10, before));
    const saved = await f.saved(clean);
    assert.equal(saved.wires[0]!.exclude, undefined, 'the same row, ticked back');
    assert.equal(saved.wires[0]!.only, undefined);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

// --- folders ---------------------------------------------------------------

/** A source with a collection in it, the shape that made the list unreadable. */
async function nested() {
  const root = await mkdtemp(join(tmpdir(), 'skillwire-ink-'));
  const src = join(root, 'src');
  const put = async (path: string, name: string): Promise<void> => {
    await mkdir(join(src, 'skills', path), { recursive: true });
    await writeFile(
      join(src, 'skills', path, 'SKILL.md'),
      `---\nname: ${name}\ndescription: about ${name}\n---\nbody\n`,
    );
  };
  await put('loose-one', 'loose-one');
  for (const n of ['one', 'two', 'three']) await put(`bundle/${n}`, n);
  const path = join(root, 'c.json');
  const config: Config = {
    wires: [{ name: 'mine', source: { path: src }, targets: ['claude'] }],
  };
  await writeFile(path, JSON.stringify(config));

  const app = render(
    <MouseProvider>
      <StoreProvider initialConfig={config} configPath={path} noFetch>
        <App />
      </StoreProvider>
    </MouseProvider>,
  );
  await tick(140);
  return {
    root,
    screen: (): string => app.lastFrame() ?? '',
    press: async (...keys: string[]) => {
      for (const k of keys) {
        app.stdin.write(k);
        await tick(30);
      }
    },
    done: () => app.unmount(),
  };
}

test('a collection is one row until it is opened', async () => {
  const f = await nested();
  try {
    await f.press(KEY.enter);
    assert.match(f.screen(), /bundle\//, 'the folder is named');
    assert.match(f.screen(), /0\/3 selected|3\/3 selected/, 'and says how much of it is picked');
    assert.doesNotMatch(f.screen(), /about one/, 'its contents stay folded away');
    assert.match(f.screen(), /loose-one/, 'artifacts outside a folder are listed as before');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('space opens a folder, and closes it again', async () => {
  const f = await nested();
  try {
    await f.press(KEY.enter, 'j'); // down onto the folder row
    await f.press(' ');
    assert.match(f.screen(), /about one/, 'opened');
    await f.press(' ');
    assert.doesNotMatch(f.screen(), /about one/, 'closed');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('right opens a folder and left closes it, without leaving the screen', async () => {
  const f = await nested();
  try {
    await f.press(KEY.enter, 'j', KEY.right);
    assert.match(f.screen(), /about one/);
    await f.press(KEY.left);
    assert.doesNotMatch(f.screen(), /about one/);
    assert.match(f.screen(), /bundle\//, 'still on the list, not back at the sources');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a search opens the folders, since a match may be inside one', async () => {
  const f = await nested();
  try {
    await f.press(KEY.enter, '/');
    for (const ch of 'two') await f.press(ch);
    await f.press(KEY.enter);
    assert.match(f.screen(), /about two/, 'the match is shown wherever it lives');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

// --- tabs ------------------------------------------------------------------

/** A source holding all three kinds, so the tab bar has something to do. */
async function threeKinds() {
  const root = await mkdtemp(join(tmpdir(), 'skillwire-ink-'));
  const src = join(root, 'src');
  await mkdir(join(src, 'skills', 'a-skill'), { recursive: true });
  await writeFile(
    join(src, 'skills', 'a-skill', 'SKILL.md'),
    '---\nname: a-skill\ndescription: the skill\n---\nb\n',
  );
  await mkdir(join(src, 'commands'), { recursive: true });
  for (const n of ['one', 'two']) {
    await writeFile(join(src, 'commands', `cmd-${n}.md`), `---\ndescription: command ${n}\n---\nb\n`);
  }
  await mkdir(join(src, 'agents'), { recursive: true });
  await writeFile(join(src, 'agents', 'an-agent.md'), '---\ndescription: the agent\n---\nb\n');

  const path = join(root, 'c.json');
  const config: Config = {
    wires: [{ name: 'mine', source: { path: src }, targets: ['claude'] }],
  };
  await writeFile(path, JSON.stringify(config));
  const app = render(
    <MouseProvider>
      <StoreProvider initialConfig={config} configPath={path} noFetch>
        <App />
      </StoreProvider>
    </MouseProvider>,
  );
  await tick(160);
  return {
    root,
    screen: (): string => app.lastFrame() ?? '',
    press: async (...keys: string[]) => {
      for (const k of keys) {
        app.stdin.write(k);
        await tick(30);
      }
    },
    done: () => app.unmount(),
  };
}

test('the kinds are tabs, counted, and only one is listed at a time', async () => {
  // Skills, commands and agents are three different things that happen to
  // share a repo. Interleaved, "how many commands" meant scrolling and
  // counting.
  const f = await threeKinds();
  try {
    await f.press(KEY.enter);
    const s = f.screen();
    assert.match(s, /skills 1\/1/);
    assert.match(s, /commands 2\/2/);
    assert.match(s, /agents 1\/1/);
    assert.match(s, /a-skill/, 'the first tab is open');
    assert.doesNotMatch(s, /cmd-one/, 'and the other kinds are not mixed into it');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a digit jumps straight to a tab', async () => {
  const f = await threeKinds();
  try {
    await f.press(KEY.enter, '2');
    assert.match(f.screen(), /cmd-one/);
    assert.doesNotMatch(f.screen(), /the skill/, 'skills are not in the commands tab');
    await f.press('3');
    assert.match(f.screen(), /an-agent/);
    await f.press('1');
    assert.match(f.screen(), /a-skill/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('tab cycles forward and wraps', async () => {
  const f = await threeKinds();
  try {
    await f.press(KEY.enter, KEY.tab);
    assert.match(f.screen(), /cmd-one/);
    await f.press(KEY.tab, KEY.tab);
    assert.match(f.screen(), /a-skill/, 'round to the start again');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('ticking in one tab is counted in its own tab', async () => {
  const f = await threeKinds();
  try {
    await f.press(KEY.enter, '2', ' ');
    assert.match(f.screen(), /commands 1\/2/, 'the commands count drops');
    assert.match(f.screen(), /skills 1\/1/, 'and the skills count does not');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a source with one kind shows no tab bar', async () => {
  // Nothing to switch between, so nothing to draw.
  const f = await fixture();
  try {
    await f.press(KEY.enter);
    assert.doesNotMatch(f.screen(), /commands \d/);
    assert.match(f.screen(), /The first skill/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('clicking a tab opens it', async () => {
  const f = await threeKinds();
  try {
    await f.press(KEY.enter);
    const line = f.screen().split('\n').findIndex((l) => l.includes('commands'));
    const column = f.screen().split('\n')[line]!.indexOf('commands') + 1;
    await f.press(clickAt(column, line + 1));
    assert.match(f.screen(), /cmd-one/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the filter strip sits under the list and never over it', async () => {
  // One row too many for the list and its last line is drawn on top of the
  // strip below it, which reads as corrupted output rather than a layout bug.
  const f = await fixture({ prefix: 'p', exclude: ['skill:gamma'] });
  try {
    await f.press(KEY.enter);
    const lines = f.screen().split('\n');
    const strip = lines.findIndex((l) => l.includes('prefix p'));
    assert.notEqual(strip, -1, f.screen());
    assert.doesNotMatch(lines[strip]!, marked('alpha'), 'an artifact is on the strip');
    const last = lines.findIndex((l) => marked('beta').test(l));
    assert.ok(last < strip, 'the list comes first');
    assert.match(lines[strip + 1]!, /╰/, 'and the strip is the last row of the panel');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the strip still fits with the search box open', async () => {
  const f = await fixture({ prefix: 'p' });
  try {
    await f.press(KEY.enter, '/');
    for (const ch of 'a') await f.press(ch);
    await f.press(KEY.enter);
    const lines = f.screen().split('\n');
    const strip = lines.findIndex((l) => l.includes('prefix p'));
    assert.notEqual(strip, -1, f.screen());
    assert.match(lines[strip + 1]!, /╰/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

// --- rows that must stay rows ----------------------------------------------

test('a description written as a block scalar still occupies one row', async () => {
  // The bug this answers: `description: |` keeps its line breaks, a renderer
  // draws every one, one skill becomes six rows, and the list outgrows the
  // panel — pushing its border and the strip below it off the screen.
  const root = await mkdtemp(join(tmpdir(), 'skillwire-ink-'));
  try {
    const src = join(root, 'src');
    for (const [id, description] of [
      ['wordy', '|\n  first line\n  second line\n  third line\n  fourth line'],
      ['plain', 'one line'],
    ]) {
      await mkdir(join(src, 'skills', id!), { recursive: true });
      await writeFile(
        join(src, 'skills', id!, 'SKILL.md'),
        `---\nname: ${id}\ndescription: ${description}\n---\nbody\n`,
      );
    }
    const path = join(root, 'c.json');
    const config: Config = {
      wires: [{ name: 'mine', source: { path: src }, targets: ['claude'] }],
    };
    await writeFile(path, JSON.stringify(config));
    const app = render(
      <MouseProvider>
        <StoreProvider initialConfig={config} configPath={path} noFetch>
          <App />
        </StoreProvider>
      </MouseProvider>,
    );
    await tick(180);
    app.stdin.write(KEY.enter);
    await tick(120);

    const lines = (app.lastFrame() ?? '').split('\n');
    const rows = lines.filter((l) => new RegExp(`[${MARKS.on}${MARKS.off}] `).test(l));
    assert.equal(rows.length, 2, `one row each:\n${app.lastFrame()}`);
    const wordy = rows.find((l) => l.includes('wordy'))!;
    assert.match(wordy, /first line second line/, 'read as a sentence');
    app.unmount();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('nothing escapes the panel when a folder is opened', async () => {
  // What the list spilling out of its box looked like: rows drawn past the
  // border, the strip somewhere in the middle of them.
  const f = await nested();
  try {
    await f.press(KEY.enter, 'j', ' ');
    const lines = f.screen().split('\n');
    const border = lines.map((l) => l.startsWith('╰')).lastIndexOf(true);
    assert.ok(border > 0, `no closing border:\n${f.screen()}`);
    const opened = lines.slice(0, border).filter((l) => /about (one|two|three)/.test(l));
    assert.ok(opened.length > 0, `the folder did not open:\n${f.screen()}`);
    for (const line of lines.slice(border + 1)) {
      assert.doesNotMatch(line, /about (one|two|three)/, `a row escaped:\n${f.screen()}`);
    }
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('an open folder indents what is inside it, and drops its own name', async () => {
  const f = await nested();
  try {
    await f.press(KEY.enter, 'j', ' ');
    const lines = f.screen().split('\n');
    const folder = lines.findIndex((l) => l.includes('bundle/'));
    const child = lines.findIndex((l) => l.includes('about one'));
    const at = (i: number): number =>
      lines[i]!.search(new RegExp(`[${MARKS.on}${MARKS.off}▸▾]`));
    assert.ok(at(child) > at(folder), `not indented:\n${f.screen()}`);
    assert.doesNotMatch(lines[child]!, /bundle-one/, 'the folder name is on the row above');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('p closes the preview panel and opens it again', async () => {
  const f = await fixture();
  try {
    await f.press(KEY.enter);
    assert.match(f.screen(), /p ›/, 'the panel says how to close it');
    await f.press('p');
    assert.doesNotMatch(f.screen(), /p ›/);
    assert.match(f.screen(), /The first skill/, 'the list is still there, wider');
    await f.press('p');
    assert.match(f.screen(), /p ›/);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the preview shows the file, not only the description', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillwire-ink-'));
  try {
    const src = join(root, 'src');
    await mkdir(join(src, 'skills', 'documented'), { recursive: true });
    await writeFile(
      join(src, 'skills', 'documented', 'SKILL.md'),
      '---\nname: documented\ndescription: what it does\n---\n\n# How it works\n\n- first step\n- second step\n',
    );
    const path = join(root, 'c.json');
    const config: Config = {
      wires: [{ name: 'mine', source: { path: src }, targets: ['claude'] }],
    };
    await writeFile(path, JSON.stringify(config));
    const app = render(
      <MouseProvider>
        <StoreProvider initialConfig={config} configPath={path} noFetch>
          <App />
        </StoreProvider>
      </MouseProvider>,
    );
    await tick(180);
    app.stdin.write(KEY.enter);
    await tick(140);
    const screen = app.lastFrame() ?? '';
    assert.match(screen, /what it does/, 'the description');
    assert.match(screen, /How it works/, 'and the file below it');
    assert.match(screen, /first step/);
    assert.doesNotMatch(screen, /^#/m, 'rendered, not printed raw');
    app.unmount();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('opening a folder does not move the rows above it', async () => {
  // The window used to centre on the cursor, so a folder of two hundred
  // arriving under it scrolled everything above out from under the eye.
  const f = await nested();
  try {
    await f.press(KEY.enter, 'j'); // onto the folder, wherever that scrolls to
    const rowOfLoose = (): number =>
      f.screen().split('\n').findIndex((l) => l.includes('loose-one'));
    const before = rowOfLoose();
    await f.press(' ');
    // The folder's own row changes — it is open now. Nothing above it should.
    assert.equal(rowOfLoose(), before, `the list moved:\n${f.screen()}`);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the position is in the strip, not a row that comes and goes', async () => {
  const many = await mkdtemp(join(tmpdir(), 'skillwire-ink-'));
  try {
    const src = join(many, 'src');
    for (let i = 0; i < 60; i++) {
      await mkdir(join(src, 'skills', `s${String(i).padStart(2, '0')}`), { recursive: true });
      await writeFile(
        join(src, 'skills', `s${String(i).padStart(2, '0')}`, 'SKILL.md'),
        `---\nname: s${i}\ndescription: number ${i}\n---\nb\n`,
      );
    }
    const path = join(many, 'c.json');
    const config: Config = {
      wires: [{ name: 'mine', source: { path: src }, targets: ['claude'] }],
    };
    await writeFile(path, JSON.stringify(config));
    const app = render(
      <MouseProvider>
        <StoreProvider initialConfig={config} configPath={path} noFetch>
          <App />
        </StoreProvider>
      </MouseProvider>,
    );
    await tick(200);
    app.stdin.write(KEY.enter);
    await tick(140);
    const lines = (app.lastFrame() ?? '').split('\n');
    // The count appears in the panel title too, so look for the range form.
    const strip = lines.findIndex((l) => /\d+–\d+ of 60/.test(l));
    assert.notEqual(strip, -1, `no position:\n${app.lastFrame()}`);
    assert.match(lines[strip + 1]!, /╰/, 'it is the last row of the panel, with the filters');
    app.unmount();
  } finally {
    await rm(many, { recursive: true, force: true });
  }
});

// --- scrolling the preview -------------------------------------------------

// A terminal that does report shift with an arrow. Plenty do not, which is
// why the brackets exist.
const SHIFT = { up: `${ESC}[1;2A`, down: `${ESC}[1;2B` };
const SCROLL = { up: '[', down: ']' };

/** A source whose file is longer than any panel. */
async function longFile() {
  const root = await mkdtemp(join(tmpdir(), 'skillwire-ink-'));
  const src = join(root, 'src');
  for (const id of ['alpha', 'beta']) {
    await mkdir(join(src, 'skills', id), { recursive: true });
    const body = Array.from({ length: 80 }, (_, i) => `${id} line ${i}`).join('\n\n');
    await writeFile(
      join(src, 'skills', id, 'SKILL.md'),
      `---\nname: ${id}\ndescription: about ${id}\n---\n\n${body}\n`,
    );
  }
  const path = join(root, 'c.json');
  const config: Config = {
    wires: [{ name: 'mine', source: { path: src }, targets: ['claude'] }],
  };
  await writeFile(path, JSON.stringify(config));
  const app = render(
    <MouseProvider>
      <StoreProvider initialConfig={config} configPath={path} noFetch>
        <App />
      </StoreProvider>
    </MouseProvider>,
  );
  await tick(200);
  return {
    root,
    screen: (): string => app.lastFrame() ?? '',
    press: async (...keys: string[]) => {
      for (const k of keys) {
        app.stdin.write(k);
        await tick(30);
      }
    },
    done: () => app.unmount(),
  };
}

/** Where the preview panel says it is: [first, last, total]. */
function previewAt(screen: string): [number, number, number] {
  const m = /(\d+)–(\d+) of (\d+)/.exec(screen);
  assert.ok(m, `no preview position:\n${screen}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

test('shift and an arrow scroll the preview, not the list', async () => {
  const f = await longFile();
  try {
    await f.press(KEY.enter);
    const listRow = (): number => f.screen().split('\n').findIndex((l) => l.includes('about beta'));
    const before = listRow();
    assert.equal(previewAt(f.screen())[0], 1, 'the file starts at the top');

    await f.press(SHIFT.down, SHIFT.down, SHIFT.down);
    assert.equal(previewAt(f.screen())[0], 4, 'three rows down');
    assert.equal(listRow(), before, 'and the list did not move');

    await f.press(SHIFT.up, SHIFT.up, SHIFT.up);
    assert.equal(previewAt(f.screen())[0], 1, 'and back again');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the preview stops at the end of the file rather than scrolling past it', async () => {
  const f = await longFile();
  try {
    await f.press(KEY.enter);
    const [, , total] = previewAt(f.screen());
    for (let i = 0; i < total + 20; i++) await f.press(SHIFT.down);
    const [, last, end] = previewAt(f.screen());
    assert.equal(last, end, `ran past the end: ${previewAt(f.screen()).join('–')}`);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a different artifact starts at the top of its own file', async () => {
  // Left where the last one was, a preview opens partway down a file nobody
  // has read a word of.
  const f = await longFile();
  try {
    await f.press(KEY.enter);
    await f.press(SHIFT.down, SHIFT.down, SHIFT.down, SHIFT.down);
    assert.equal(previewAt(f.screen())[0], 5);
    await f.press('j');
    assert.match(f.screen(), /beta line 0/, 'now showing the other file');
    assert.equal(previewAt(f.screen())[0], 1, 'from its top');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the wheel over the preview scrolls it', async () => {
  const f = await longFile();
  try {
    await f.press(KEY.enter);
    const lines = f.screen().split('\n');
    const row = lines.findIndex((l) => l.includes('alpha line 1'));
    const column = lines[row]!.indexOf('alpha line 1') + 1;
    await f.press(`${ESC}[<65;${column};${row + 1}M`); // wheel down, over the panel
    assert.equal(previewAt(f.screen())[0], 4, 'three rows, as a wheel notch should');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('the wheel over the list moves the list, not the preview', async () => {
  const f = await longFile();
  try {
    await f.press(KEY.enter);
    const lines = f.screen().split('\n');
    const row = lines.findIndex((l) => marked('alpha').test(l));
    await f.press(`${ESC}[<65;4;${row + 1}M`);
    assert.match(f.screen(), /beta line 0/, 'the cursor moved down the list');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('brackets scroll the preview, on any terminal', async () => {
  // Whether shift arrives with an arrow is the terminal's business: plenty
  // send the bare sequence, and then a keystroke meant for the preview moves
  // the list instead.
  const f = await longFile();
  try {
    await f.press(KEY.enter);
    const listRow = (): number => f.screen().split('\n').findIndex((l) => l.includes('about beta'));
    const before = listRow();

    await f.press(SCROLL.down, SCROLL.down, SCROLL.down);
    assert.equal(previewAt(f.screen())[0], 4);
    assert.equal(listRow(), before, 'the list stayed put');

    await f.press(SCROLL.up, SCROLL.up);
    assert.equal(previewAt(f.screen())[0], 2);
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});

test('a plain arrow still moves the list, whatever the terminal sends', async () => {
  const f = await longFile();
  try {
    await f.press(KEY.enter);
    assert.match(f.screen(), /alpha line 0/);
    await f.press(KEY.down);
    assert.match(f.screen(), /beta line 0/, 'the cursor moved and the preview followed');
  } finally {
    f.done();
    await rm(f.root, { recursive: true, force: true });
  }
});
