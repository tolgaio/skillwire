import { Alert, Badge, ConfirmInput } from '@inkjs/ui';
import { Box, Text} from 'ink';
import { useKeys } from '../useKeys.js';
import { useState, type ReactNode } from 'react';
import type { Artifact } from '../../artifact.js';
import { isSelected } from '../../selection.js';
import type { SourceConfig, Wire } from '../../config.js';
import { Cell, List, Rest, rowColour } from '../components/List.js';
import { Panel, Row } from '../components/chrome.js';
import { moveCursor, nav } from '../keys.js';
import { useStore } from '../store.js';

export const SOURCES_KEYS: [string, string][] = [
  ['⏎  l', 'browse this source'],
  ['a', 'add a source'],
  ['e', 'edit it'],
  ['d', 'delete it'],
  ['f', 'fetch — update a git source'],
  ['r', 're-read from disk'],
  ['i', 'install it, with --prune'],
  ['D', 'dry run that install'],
];

export const SOURCES_HINTS: [string, string][] = [
  ['⏎', 'browse'],
  ['a', 'add'],
  ['e', 'edit'],
  ['d', 'delete'],
  ['f', 'fetch'],
  ['i', 'install'],
  ['?', 'keys'],
  ['q', 'quit'],
];

export function describeSource(s: SourceConfig): string {
  if (s.git) return `git ${s.git}${s.ref ? `@${s.ref}` : ''}`;
  return s.path ?? '(no source)';
}

export function targetId(t: Wire['targets'][number]): string {
  return typeof t === 'string' ? t : t.id;
}

export function Sources({
  height,
  width,
  onQuit,
}: {
  height: number;
  width: number;
  onQuit: () => void;
}): ReactNode {
  const store = useStore();
  const [cursor, setCursor] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const wires = store.config.wires;
  const at = Math.min(cursor, Math.max(0, wires.length - 1));
  const current = wires[at];

  useKeys(
    (input, key) => {
      const where = nav(input, key);
      if (where) {
        const next = moveCursor(where, at, wires.length, height - 2);
        if (next !== null) return setCursor(next);
        if (where === 'right' && current) return browse();
        return;
      }
      if (key.return && current) return browse();
      if (key.escape || input === 'q') return onQuit();

      switch (input) {
        case 'a':
          return store.push({ screen: 'form', wire: null });
        case 'e':
          return current && store.push({ screen: 'form', wire: at });
        case 'd':
          return current && setConfirming(true);
        case 'f':
          if (current) void store.load(current, true).then(() => store.say(`fetched ${current.name}`));
          return;
        case 'r':
          if (current) {
            store.invalidate(current);
            void store.load(current, false);
          }
          return;
        case 'i':
          return current ? void store.install(at, false) : undefined;
        case 'D':
          return current ? void store.install(at, true) : undefined;
      }
    },
    { isActive: !confirming && !store.help },
  );

  function browse(): void {
    if (!current) return;
    const cached = store.cached(current);
    if (!cached) {
      void store.load(current, false).then((l) => {
        if (l.error) store.say(l.error, 'error');
        else store.push({ screen: 'browse', wire: at });
      });
      return;
    }
    if (cached.error) return store.say(cached.error, 'error');
    store.push({ screen: 'browse', wire: at });
  }

  if (confirming && current) {
    return (
      <Panel title={`Delete "${current.name}"?`} colour="yellow" grow>
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            This removes it from the config only. Artifacts it already installed stay where
          </Text>
          <Text dimColor>
            they are — run skillwire install --prune afterwards to clear them out.
          </Text>
          <Box marginTop={1}>
            <Text>Delete it? </Text>
            <ConfirmInput
              onConfirm={() => {
                setConfirming(false);
                void store.removeWire(at).then(() => store.say(`deleted ${current.name}`));
                setCursor(Math.max(0, at - 1));
              }}
              onCancel={() => setConfirming(false)}
            />
          </Box>
        </Box>
      </Panel>
    );
  }

  const nameWidth = Math.min(24, Math.max(6, ...wires.map((w) => w.name.length), 4));

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Panel
        title="sources"
        subtitle={`${wires.length} configured`}
        grow
      >
        {wires.length ? (
          <>
            <Box flexShrink={0}>
              <Text dimColor>{'  '}</Text>
              <Cell width={nameWidth + 2}>
                <Text dimColor>NAME</Text>
              </Cell>
              <Cell width={Math.max(18, width - nameWidth - 42)}>
                <Text dimColor>SOURCE</Text>
              </Cell>
              <Cell width={12}>
                <Text dimColor>SELECTED</Text>
              </Cell>
              <Text dimColor>TARGETS</Text>
            </Box>
            <List
              items={wires}
              cursor={at}
              height={height - 3}
              label="source"
              onPick={setCursor}
              onScroll={(d) =>
                setCursor((c) => Math.max(0, Math.min(wires.length - 1, c + d)))
              }
              render={(w, here) => {
                const cached = store.cached(w);
                return (
                  <>
                    <Cell width={nameWidth + 2}>
                      <Text bold={here} {...rowColour(here)}>
                        {w.name}
                      </Text>
                    </Cell>
                    <Cell width={Math.max(18, width - nameWidth - 42)}>
                      <Text wrap="truncate" {...rowColour(here, true)}>
                        {describeSource(w.source)}
                      </Text>
                    </Cell>
                    <Cell width={12}>
                      {cached?.error ? (
                        <Text color="red">error</Text>
                      ) : cached ? (
                        <Text {...rowColour(here)}>
                          {countSelected(w, cached.artifacts)}
                          <Text {...rowColour(here, true)}>/{cached.artifacts.length}</Text>
                        </Text>
                      ) : (
                        <Text {...rowColour(here, true)}>—</Text>
                      )}
                    </Cell>
                    <Rest>
                      <Text wrap="truncate-end" {...rowColour(here, true)}>
                        {w.targets.map(targetId).join(', ')}
                      </Text>
                    </Rest>
                  </>
                );
              }}
            />
          </>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>No sources yet.</Text>
            <Box marginTop={1}>
              <Text>
                Press <Text color="cyan">a</Text> to add one — a directory on this machine, or a
                repository like <Text color="cyan">owner/name</Text>.
              </Text>
            </Box>
          </Box>
        )}
      </Panel>
      {current ? <SourceDetail wire={current} /> : null}
    </Box>
  );
}

function countSelected(wire: Wire, artifacts: Artifact[]): number {
  return artifacts.filter((a) => isSelected(a, wire)).length;
}

function SourceDetail({ wire }: { wire: Wire }): ReactNode {
  const store = useStore();
  const cached = store.cached(wire);

  if (cached?.error) {
    return (
      <Box flexShrink={0} paddingX={1}>
        <Alert variant="error">{cached.error}</Alert>
      </Box>
    );
  }

  return (
    <Panel title={wire.name}>
      <Row label="from">
        <Text dimColor wrap="truncate-end">
          {cached?.sourceName ?? describeSource(wire.source)}
        </Text>
      </Row>
      <Row label="filters">
        <Box>
          {wire.only?.length ? (
            <Box marginRight={1}>
              <Badge color="green">only {wire.only.join(' ')}</Badge>
            </Box>
          ) : null}
          {wire.exclude?.length ? (
            <Box marginRight={1}>
              <Badge color="yellow">exclude {wire.exclude.join(' ')}</Badge>
            </Box>
          ) : null}
          {wire.prefix ? (
            <Box marginRight={1}>
              <Badge color="cyan">prefix {wire.prefix}</Badge>
            </Box>
          ) : null}
          {!wire.only?.length && !wire.exclude?.length && !wire.prefix ? (
            <Text dimColor>everything</Text>
          ) : null}
        </Box>
      </Row>
      <Row label="targets">
        <Text dimColor>{wire.targets.map(targetId).join(', ')}</Text>
      </Row>
    </Panel>
  );
}

