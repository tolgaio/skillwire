import { Badge, TextInput } from '@inkjs/ui';
import { Box, Text} from 'ink';
import { useKeys } from '../useKeys.js';
import { useState, type ReactNode } from 'react';
import { KINDS, type Artifact, type Kind } from '../../artifact.js';
import {
  blockingExclude,
  compact,
  isSelected,
  setSelection,
  toggle,
} from '../../selection.js';
import { Cell, Check, List, Rest, rowColour } from '../components/List.js';
import { Panel, Row } from '../components/chrome.js';
import { moveCursor, nav } from '../keys.js';
import { useStore } from '../store.js';

export const BROWSE_KEYS: [string, string][] = [
  ['space', 'tick or untick'],
  ['a', 'tick everything listed'],
  ['n', 'untick everything listed'],
  ['v', 'invert what is listed'],
  ['s', 'show all / selected / unselected'],
  ['/', 'search names and descriptions'],
  ['f', 'edit the filter patterns'],
  ['K', 'choose which kinds are read'],
  ['i', 'install this source, with --prune'],
  ['D', 'dry run that install'],
];

export const BROWSE_HINTS: [string, string][] = [
  ['space', 'tick'],
  ['a', 'all'],
  ['n', 'none'],
  ['s', 'showing'],
  ['/', 'search'],
  ['f', 'filters'],
  ['i', 'install'],
  ['?', 'keys'],
];

type Showing = 'all' | 'selected' | 'unselected';
const NEXT: Record<Showing, Showing> = {
  all: 'selected',
  selected: 'unselected',
  unselected: 'all',
};

/** A kind heading, or one artifact. Headings are labels, not destinations. */
type Entry = { header: string } | { artifact: Artifact };

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

  /**
   * What the list is currently showing.
   *
   * The showing filter exists because five hundred skills is not reviewable by
   * scrolling, and the question anyone actually has is "what did I pick?".
   */
  const matching = artifacts.filter((a) => {
    if (showing !== 'all') {
      const on = isSelected(a, wire);
      if (showing === 'selected' ? !on : on) return false;
    }
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return a.id.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
  });

  const entries: Entry[] = [];
  for (const kind of KINDS) {
    const of = matching.filter((a) => a.kind === kind);
    if (!of.length) continue;
    const on = of.filter((a) => isSelected(a, wire)).length;
    entries.push({ header: `${kind}s  ${on}/${of.length}` });
    for (const a of of) entries.push({ artifact: a });
  }

  // The list opens on a heading, so nudge past it rather than letting the
  // first keypress land on a label and appear to do nothing.
  const at = clampToArtifact(entries, Math.min(cursor, Math.max(0, entries.length - 1)));
  const entry = entries[at];
  const current = entry && 'artifact' in entry ? entry.artifact : undefined;
  const selected = artifacts.filter((a) => isSelected(a, wire)).length;

  useKeys(
    (input, key) => {
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

      const where = nav(input, key);
      if (where) {
        const next = moveCursor(where, at, entries.length, height - 2);
        if (next !== null) return setCursor(clampToArtifact(entries, next, next < at ? -1 : 1));
        if (where === 'left') return store.pop();
        return;
      }

      if (input === ' ' || key.return) return tick();

      switch (input) {
        case '/':
          return setSearching(true);
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
    { isActive: !searching && !store.help },
  );

  /** Click: land on the row, and tick it — that is what a checkbox is for. */
  function pick(index: number): void {
    const target = entries[index];
    if (!target || !('artifact' in target)) return;
    setCursor(index);
    tick(target.artifact);
  }

  function tick(a: Artifact | undefined = current): void {
    if (!a) return;
    const current = a;
    const on = isSelected(current, wire);
    const blocked = !on && blockingExclude(current, wire);
    if (blocked) {
      return store.say(`excluded by "${blocked}" — press f to edit that pattern`, 'warn');
    }
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
  const sideWidth = width >= 100 ? Math.min(46, Math.floor(width * 0.34)) : 0;
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
          {/* Always one line, even with nothing in it. Ticking the first
              artifact adds a filter badge, and a bar that appears only then
              would shove the whole list down a row under the pointer. */}
          <Box flexShrink={0} height={1}>
            {showing !== 'all' ? (
              <Box marginRight={1}>
                <Badge color="cyan">showing {showing}</Badge>
              </Box>
            ) : null}
            {wire.prefix ? (
              <Box marginRight={1}>
                <Badge color="magenta">prefix {wire.prefix}</Badge>
              </Box>
            ) : null}
            {wire.exclude?.length ? (
              <Box marginRight={1}>
                <Badge color="yellow">exclude {wire.exclude.join(' ')}</Badge>
              </Box>
            ) : null}
            {wire.only?.length ? (
              <Box marginRight={1}>
                <Badge color="green">only {wire.only.join(' ')}</Badge>
              </Box>
            ) : null}
          </Box>
          <List
            items={entries}
            cursor={at}
            height={height - 3}
            label="artifact"
            empty={emptyReason(query, showing)}
            countable={(e) => 'artifact' in e}
            onPick={pick}
            onScroll={(d) =>
              setCursor((c) => clampToArtifact(entries, Math.max(0, Math.min(entries.length - 1, c + d * 3)), d))
            }
            render={(e, here) =>
              'header' in e ? (
                <Text dimColor>{e.header}</Text>
              ) : (
                <>
                  <Cell width={4}>
                    <Check on={isSelected(e.artifact, wire)} here={here} />
                  </Cell>
                  <Cell width={idWidth + 2}>
                    <Text bold={here} wrap="truncate" {...rowColour(here)}>
                      {e.artifact.id}
                    </Text>
                  </Cell>
                  <Rest>
                    <Text wrap="truncate-end" {...rowColour(here, true)}>
                      {e.artifact.description || '(no description)'}
                    </Text>
                  </Rest>
                </>
              )
            }
          />
        </Panel>

        {sideWidth && current ? <Detail artifact={current} width={sideWidth} /> : null}
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
 * The side panel.
 *
 * The list has room for one line of a description; a skill's is usually a
 * paragraph saying when to use it, which is exactly what decides the checkbox.
 * A column beside the list is the natural place for it, and is the thing a
 * row-by-row renderer could not do at all.
 */
function Detail({ artifact, width }: { artifact: Artifact; width: number }): ReactNode {
  return (
    <Panel title={artifact.id} width={width} colour="cyan">
      <Row label="kind" width={8}>
        <Text dimColor>{artifact.kind}</Text>
      </Row>
      <Row label="files" width={8}>
        <Text dimColor>{artifact.files.length}</Text>
      </Row>
      {artifact.group ? (
        <Row label="group" width={8}>
          <Text dimColor>{artifact.group}</Text>
        </Row>
      ) : null}
      <Box marginTop={1} flexGrow={1}>
        <Text dimColor>{artifact.description || '(no description)'}</Text>
      </Box>
    </Panel>
  );
}

function facts(a: Artifact): string {
  return `${a.kind} · ${a.files.length} file${a.files.length === 1 ? '' : 's'}`;
}

function emptyReason(query: string, showing: Showing): string {
  if (query) return 'nothing matches that search';
  if (showing === 'selected') return 'nothing is selected';
  if (showing === 'unselected') return 'everything is selected';
  return 'this source has nothing';
}

/**
 * Step off a kind heading, in the direction of travel.
 *
 * Headings are labels, not destinations. The list also opens on one, so
 * without this the first space would land on a label and appear to do nothing.
 */
function clampToArtifact(entries: Entry[], index: number, dir = 1): number {
  if (!entries.length) return 0;
  const isArtifact = (i: number): boolean => !!entries[i] && 'artifact' in entries[i]!;
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
