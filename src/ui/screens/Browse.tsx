import { TextInput } from '@inkjs/ui';
import { Box, Text, useBoxMetrics } from 'ink';
import { useKeys } from '../useKeys.js';
import { useEffect, useState, type ReactNode } from 'react';
import { useRegion } from '../mouse.js';
import { KINDS, type Artifact, type Kind } from '../../artifact.js';
import {
  compact,
  isSelected,
  setSelection,
  toggle,
} from '../../selection.js';
import { Cell, Check, List, listWindow, MARKS, Rest, rowColour } from '../components/List.js';
import { markdownRows, Markdown } from '../components/Markdown.js';
import { Tabs, tabFor, type Tab } from '../components/Tabs.js';
import { Chip, Panel, Row } from '../components/chrome.js';
import { clampOffset, moveCursor, nav } from '../keys.js';
import { oneLine } from '../text.js';
import { useStore } from '../store.js';

export const BROWSE_KEYS: [string, string][] = [
  ['space', 'tick, or open a folder'],
  ['a', 'tick everything listed'],
  ['n', 'untick everything listed'],
  ['v', 'invert what is listed'],
  ['tab  1 2 3', 'skills, commands, agents'],
  ['p', 'the preview panel, on or off'],
  ['[  ]', 'scroll the preview — the wheel does too'],
  ['s', 'show all / selected / unselected'],
  ['/', 'search names and descriptions'],
  ['f', 'edit the filter patterns'],
  ['K', 'choose which kinds are read'],
  ['i', 'install this source, with --prune'],
  ['D', 'dry run that install'],
];

export const BROWSE_HINTS: [string, string][] = [
  ['tab', 'kind'],
  ['space', 'tick'],
  ['a/n', 'all/none'],
  ['s', 'showing'],
  ['p', 'preview'],
  ['[ ]', 'scroll it'],
  ['/', 'search'],
  ['f', 'filters'],
  ['i', 'install'],
  ['?', 'keys'],
];

/** A colour per kind, so a tab is recognisable before it is read. */
const KIND_COLOUR: Record<Kind, string> = {
  skill: 'cyan',
  command: 'magenta',
  agent: 'yellow',
};

type Showing = 'all' | 'selected' | 'unselected';
const NEXT: Record<Showing, Showing> = {
  all: 'selected',
  selected: 'unselected',
  unselected: 'all',
};

/**
 * A kind heading, a collapsible folder, or one artifact.
 *
 * Headings are labels, not destinations. Folders are: a collection of two
 * hundred skills is one row until you open it, which is the difference between
 * a list you can read and a list you scroll past.
 */
type Entry =
  | { header: string }
  | { folder: string; kind: Kind; on: number; of: number; open: boolean }
  | { artifact: Artifact; inFolder?: boolean };

export function Browse({
  index,
  height,
  width,
}: {
  index: number;
  height: number;
  width: number;
}): ReactNode {
  const store = useStore();
  const wire = store.wireAt(index);
  const artifacts = store.cached(wire)?.artifacts ?? [];

  const [cursor, setCursor] = useState(0);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [showing, setShowing] = useState<Showing>('all');
  const [tab, setTab] = useState<Kind | null>(null);
  const [preview, setPreview] = useState(true);
  const [offset, setOffset] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [measured, setMeasured] = useState(0);
  /** Folders opened by hand. A collection is a summary until asked otherwise. */
  const [opened, setOpened] = useState<Set<string>>(new Set());

  /**
   * One tab per kind the source actually holds.
   *
   * Skills, commands and agents are three different things that happen to live
   * in one repo, and interleaving them made a list of five hundred where the
   * answer to "how many commands" was to scroll and count.
   */
  const kinds = KINDS.filter((k) => artifacts.some((a) => a.kind === k));
  const active = tab && kinds.includes(tab) ? tab : (kinds[0] ?? 'skill');
  const tabs: Tab[] = kinds.map((kind) => {
    const of = artifacts.filter((a) => a.kind === kind);
    return {
      key: kind,
      label: `${kind}s`,
      colour: KIND_COLOUR[kind],
      on: of.filter((a) => isSelected(a, wire)).length,
      of: of.length,
    };
  });

  // What is left for the list once the panel's own furniture has its share:
  // the tab bar and its margin, the filter strip, and the search box when it
  // is up. The list keeps its own position counter within this. Counted rather
  // than guessed at, because one row too many draws the last line over the
  // strip below it.
  const rows = Math.max(1, height - 2 - (tabs.length > 1 ? 0 : 2) - (searching || query ? 1 : 0));

  /**
   * What the list is currently showing.
   *
   * The showing filter exists because five hundred skills is not reviewable by
   * scrolling, and the question anyone actually has is "what did I pick?".
   */
  const matching = artifacts.filter((a) => {
    if (a.kind !== active) return false;
    if (showing !== 'all') {
      const on = isSelected(a, wire);
      if (showing === 'selected' ? !on : on) return false;
    }
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return a.id.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
  });

  // A search is a reason to see everything that matched, wherever it lives.
  const filtering = !!query.trim() || showing !== 'all';
  const entries: Entry[] = [];
  const folders = new Map<string, Artifact[]>();
  for (const a of matching) {
    if (!a.group) entries.push({ artifact: a });
    else folders.set(a.group, [...(folders.get(a.group) ?? []), a]);
  }
  for (const [folder, held] of [...folders].sort((x, y) => x[0].localeCompare(y[0]))) {
    const open = filtering || opened.has(`${active}/${folder}`);
    entries.push({
      folder,
      kind: active,
      open,
      on: held.filter((a) => isSelected(a, wire)).length,
      of: held.length,
    });
    if (open) for (const a of held) entries.push({ artifact: a, inFolder: true });
  }

  // The list opens on a heading, so nudge past it rather than letting the
  // first keypress land on a label and appear to do nothing.
  const at = clampToArtifact(entries, Math.min(cursor, Math.max(0, entries.length - 1)));
  const entry = entries[at];
  const current = entry && 'artifact' in entry ? entry.artifact : undefined;
  const folder = entry && 'folder' in entry ? entry : undefined;
  const selected = artifacts.filter((a) => isSelected(a, wire)).length;

  useKeys(
    (input, key) => {
      // As in the filter editor: the search box does not handle escape, so
      // this has to, or there is no way to abandon a search once started.
      if (searching) {
        if (key.escape) {
          setQuery('');
          setSearching(false);
          setCursor(0);
        }
        return;
      }
      if (key.escape) {
        if (query || showing !== 'all') {
          // First escape drops the view filters, the next leaves the screen.
          setQuery('');
          setShowing('all');
          setCursor(0);
          return;
        }
        return store.pop();
      }

      // Brackets rather than shift and an arrow. Whether a terminal reports
      // shift with an arrow at all is up to the terminal — plenty send the
      // bare sequence, and then the keystroke meant for the preview moves the
      // list instead. Shift is still honoured where it does arrive.
      if (input === '[' || input === ']') {
        return setScroll((s) => Math.max(0, s + (input === '[' ? -1 : 1)));
      }
      if (key.shift && (key.upArrow || key.downArrow)) {
        return setScroll((s) => Math.max(0, s + (key.upArrow ? -1 : 1)));
      }

      const moved = tabFor(input, key, tabs, active);
      if (moved) {
        setTab(moved as Kind);
        setCursor(0);
        return;
      }

      const where = nav(input, key);
      if (where) {
        const next = moveCursor(where, at, entries.length, rows);
        if (next !== null) return setCursor(clampToArtifact(entries, next, next < at ? -1 : 1));
        // On a folder, left and right close and open it rather than leaving.
        if (folder && where === 'right' && !folder.open)
          return toggleFolder(folder.kind, folder.folder);
        if (folder && where === 'left' && folder.open)
          return toggleFolder(folder.kind, folder.folder);
        if (where === 'left') return store.pop();
        return;
      }

      if (input === ' ' || key.return) {
        if (folder) return toggleFolder(folder.kind, folder.folder);
        return tick();
      }

      switch (input) {
        case '/':
          return setSearching(true);
        case 'p':
          return setPreview((open) => !open);
        case 's':
          setShowing(NEXT[showing]);
          return setCursor(0);
        case 'a':
          return bulk(true);
        case 'n':
          return bulk(false);
        case 'v': {
          let next = wire;
          for (const a of matching) next = toggle(next, a, !isSelected(a, next));
          return void store.replaceWire(index, compact(next, artifacts));
        }
        case 'f':
          return store.push({ screen: 'filters', wire: index });
        case 'K':
          return store.push({ screen: 'kinds', wire: index });
        case 'i':
          return void store.install(index, false);
        case 'D':
          return void store.install(index, true);
      }
    },
    { isActive: !store.help },
  );

  function toggleFolder(kind: Kind, name: string): void {
    const key = `${kind}/${name}`;
    setOpened((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Click: land on the row, and tick it — that is what a checkbox is for. */
  function pick(index: number): void {
    const target = entries[index];
    if (!target) return;
    setCursor(index);
    if ('folder' in target) return toggleFolder(target.kind, target.folder);
    if ('artifact' in target) tick(target.artifact);
  }

  function tick(a: Artifact | undefined = current): void {
    if (!a) return;
    const current = a;
    const on = isSelected(current, wire);
    // No longer refused, and no longer explained. Ticking something a pattern
    // excludes adds it to `include`, which is matched after `exclude` — one
    // artifact named without touching the pattern covering the rest. The strip
    // says an include exists, which outlasts any note this could print.
    if (on && selected === 1) {
      return store.say('a source with nothing selected installs nothing', 'warn');
    }
    void store.replaceWire(index, compact(toggle(wire, current, !on), artifacts));
  }

  function bulk(on: boolean): void {
    const next = setSelection(wire, artifacts, matching, on);
    if (!on && !artifacts.filter((a) => isSelected(a, next)).length) {
      return store.say('a source with nothing selected installs nothing', 'warn');
    }
    void store.replaceWire(index, next);
  }

  // The side panel carries the full description, so the list can give more of
  // its width to ids once there is one.
  const sideWidth = preview && width >= 100 ? Math.min(76, Math.floor(width * 0.42)) : 0;
  // The same offset the list renders from, so the position in the strip is
  // the position on screen rather than a second opinion about it.
  const from = clampOffset(offset, at, entries.length, rows);
  if (from !== offset) setOffset(from);
  const window = listWindow(entries, from, rows, (e) => 'artifact' in e);

  // The preview, as rows and a window onto them. Built here rather than inside
  // the panel because the scroll position has to be clamped against the total,
  // and only the caller holding the position can do that.
  //
  // The description is part of what scrolls. Fixed above the file, a long one
  // took the whole panel and left the file with nowhere to be.
  const previewColumn = Math.max(1, sideWidth - 4);
  const previewRows = current
    ? [
        ...markdownRows(oneLine(current.description) || '(no description)', previewColumn),
        <Text dimColor>{' '}</Text>,
        <Text dimColor>{'─'.repeat(previewColumn)}</Text>,
        <Text dimColor>{' '}</Text>,
        ...markdownRows(current.body, previewColumn),
      ]
    : [];
  // Measured, not counted. Every attempt to derive this from the terminal
  // height had to know about the panel's border, title, facts, gap and footer,
  // and each time one of those changed the window was wrong again — showing
  // rows nobody could see, or reporting a position about nothing.
  const previewLines = Math.max(1, measured || height - 6);
  const previewAt = Math.max(0, Math.min(scroll, previewRows.length - previewLines));
  if (previewAt !== scroll) setScroll(previewAt);

  // A new artifact starts at the top of its own file, not partway down where
  // the last one was left.
  const [shown, setShown] = useState<string | undefined>(undefined);
  if (current?.id !== shown) {
    setShown(current?.id);
    if (scroll) setScroll(0);
  }
  const idWidth = Math.min(sideWidth ? 30 : 38, Math.max(14, ...matching.map((a) => a.id.length)));

  return (
    <Box flexDirection="column" flexGrow={1}>
      {searching || query ? (
        <Box paddingX={1} flexShrink={0}>
          <Text color="cyan">/ </Text>
          {searching ? (
            <TextInput
              defaultValue={query}
              placeholder="name or description…"
              onChange={setQuery}
              onSubmit={() => setSearching(false)}
            />
          ) : (
            <Text>{query}</Text>
          )}
        </Box>
      ) : null}

      <Box flexGrow={1}>
        <Panel
          title={wire.name}
          subtitle={`${selected} of ${artifacts.length} selected`}
          grow
        >
          <Tabs
            tabs={tabs}
            active={active}
            onSelect={(k) => {
              setTab(k as Kind);
              setCursor(0);
            }}
          />
          <List
            items={entries}
            cursor={at}
            height={rows}
            label="artifact"
            empty={emptyReason(query, showing, active)}
            countable={(e) => 'artifact' in e}
            offset={from}
            onPick={pick}
            onScroll={(d) =>
              setCursor((c) => clampToArtifact(entries, Math.max(0, Math.min(entries.length - 1, c + d * 3)), d))
            }
            render={(e, here) =>
              'header' in e ? (
                <Text dimColor>{e.header}</Text>
              ) : 'folder' in e ? (
                <>
                  <Cell width={MARKS.on.length + 1}>
                    <Text {...rowColour(here, true)}>{e.open ? '▾' : '▸'}</Text>
                  </Cell>
                  <Cell width={idWidth + 2}>
                    <Text bold={here} {...rowColour(here)}>
                      {e.folder}/
                    </Text>
                  </Cell>
                  <Rest>
                    <Text wrap="truncate-end" {...rowColour(here, true)}>
                      {e.on}/{e.of} selected{e.open ? '' : ' — space to open'}
                    </Text>
                  </Rest>
                </>
              ) : (
                <>
                  {/* Inside an open folder, indented and with the folder's own
                      name taken off the front: the row already sits under it. */}
                  {e.inFolder ? <Text> </Text> : null}
                  <Cell width={MARKS.on.length + 1}>
                    <Check on={isSelected(e.artifact, wire)} here={here} />
                  </Cell>
                  <Cell width={idWidth + (e.inFolder ? 1 : 2)}>
                    <Text bold={here} wrap="truncate" {...rowColour(here)}>
                      {oneLine(shortId(e.artifact))}
                    </Text>
                  </Cell>
                  <Rest>
                    <Text wrap="truncate-end" {...rowColour(here, true)}>
                      {oneLine(e.artifact.description) || '(no description)'}
                    </Text>
                  </Rest>
                </>
              )
            }
          />
          {/* Under the list, not over it. What the filters are is worth a
              glance, not the first thing read. Always one line even when there
              is nothing to say, so that setting the first filter cannot shove
              every row down under the pointer. */}
          <Box flexShrink={0} height={1} overflow="hidden">
            {/* The position lives here rather than under the list, where it
                was a row that appeared as soon as a list outgrew the window —
                and every row above it moved up to make space, so opening a
                folder scrolled the list out from under the cursor. */}
            {window.total > window.last - window.first + 1 ? (
              <Chip>
                {window.first}–{window.last} of {window.total}
              </Chip>
            ) : null}
            {showing !== 'all' ? <Chip>showing {showing}</Chip> : null}
            {wire.prefix ? <Chip>prefix {wire.prefix}</Chip> : null}
            {wire.exclude?.length ? <Chip>exclude {summarise(wire.exclude)}</Chip> : null}
            {wire.include?.length ? <Chip>include {summarise(wire.include)}</Chip> : null}
            {wire.only?.length ? <Chip>only {summarise(wire.only)}</Chip> : null}
          </Box>
        </Panel>

        {sideWidth && current ? (
          <Detail
            artifact={current}
            width={sideWidth}
            rows={previewRows}
            offset={previewAt}
            lines={previewLines}
            onClose={() => setPreview(false)}
            onScroll={(d) => setScroll((s) => s + d * 3)}
            onLines={setMeasured}
          />
        ) : null}
      </Box>

      {!sideWidth && current ? (
        <Panel title={current.id} subtitle={facts(current)}>
          <Text dimColor wrap="truncate-end">
            {current.description || '(no description)'}
          </Text>
        </Panel>
      ) : null}
    </Box>
  );
}

/**
 * The preview panel.
 *
 * The list has room for one line of a description; what decides a checkbox is
 * usually the paragraph saying when to use the thing, and after that the file
 * itself. Both are here, and `p` puts the panel away when the list wants the
 * width more.
 *
 * Only the primary file is shown. A skill can carry a dozen, and a panel that
 * tried to be a file browser would stop being a glance.
 */
function Detail({
  artifact,
  width,
  rows,
  offset,
  lines,
  onClose,
  onScroll,
  onLines,
}: {
  artifact: Artifact;
  width: number;
  rows: ReactNode[];
  offset: number;
  lines: number;
  onClose: () => void;
  onScroll: (direction: -1 | 1) => void;
  onLines: (lines: number) => void;
}): ReactNode {
  const close = useRegion({ onClick: onClose });
  const body = useRegion({ onWheel: onScroll });
  const { height: measured } = useBoxMetrics(body);
  useEffect(() => {
    if (measured) onLines(measured);
  }, [measured, onLines]);
  const facts = [artifact.kind, `${artifact.files.length} file${artifact.files.length === 1 ? '' : 's'}`];
  if (artifact.group) facts.push(artifact.group);
  const more = rows.length > lines;

  return (
    <Panel title={oneLine(artifact.id)} width={width} colour="cyan">
      <Box flexShrink={0}>
        <Text dimColor>{facts.join('  ·  ')}</Text>
      </Box>
      <Box ref={body} flexDirection="column" flexGrow={1} overflow="hidden" marginTop={1}>
        <Markdown rows={rows} offset={offset} lines={lines} />
      </Box>
      <Box flexShrink={0} justifyContent="space-between">
        <Text dimColor>
          {more ? `⇧↑↓  ${offset + 1}–${Math.min(rows.length, offset + lines)} of ${rows.length}` : ''}
        </Text>
        <Box ref={close}>
          <Text dimColor>p ›</Text>
        </Box>
      </Box>
    </Panel>
  );
}

/** Inside a folder, the folder's own name is already on the row above. */
function shortId(a: Artifact): string {
  return a.group && a.id.startsWith(`${a.group}-`) ? a.id.slice(a.group.length + 1) : a.id;
}

/**
 * A pattern list, short enough for one line.
 *
 * Eleven of them spelled out ran past the panel and painted over the list;
 * `f` is where the whole list lives.
 */
function summarise(patterns: string[]): string {
  if (patterns.length === 1) return patterns[0]!;
  if (patterns.length === 2) return patterns.join(' ');
  return `${patterns.length} patterns`;
}

function facts(a: Artifact): string {
  return `${a.kind} · ${a.files.length} file${a.files.length === 1 ? '' : 's'}`;
}

function emptyReason(query: string, showing: Showing, kind: Kind): string {
  // Named, because the list is one tab now: "nothing is selected" would read
  // as a statement about the whole source rather than about the tab you are on.
  if (query) return `no ${kind}s match that search`;
  if (showing === 'selected') return `no ${kind}s are selected`;
  if (showing === 'unselected') return `every ${kind} is selected`;
  return `this source has no ${kind}s`;
}

/**
 * Step off a kind heading, in the direction of travel.
 *
 * Headings are labels, not destinations. The list also opens on one, so
 * without this the first space would land on a label and appear to do nothing.
 * Folders are destinations — they open and close.
 */
function clampToArtifact(entries: Entry[], index: number, dir = 1): number {
  if (!entries.length) return 0;
  const isArtifact = (i: number): boolean =>
    !!entries[i] && !('header' in entries[i]!);
  const at = Math.max(0, Math.min(entries.length - 1, index));
  if (isArtifact(at)) return at;
  for (let i = at; i >= 0 && i < entries.length; i += dir) if (isArtifact(i)) return i;
  // Nothing that way — the heading is the last row, so come back the other way.
  for (let i = at; i >= 0 && i < entries.length; i -= dir) if (isArtifact(i)) return i;
  return at;
}

export function selectedKinds(wire: { kinds?: Kind[] }): Kind[] {
  return wire.kinds ?? KINDS;
}
