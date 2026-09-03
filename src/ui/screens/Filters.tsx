import { Badge, TextInput } from '@inkjs/ui';
import { Box, Text} from 'ink';
import { useKeys } from '../useKeys.js';
import { useState, type ReactNode } from 'react';
import { patternCounts } from '../../selection.js';
import { Cell, List, rowColour } from '../components/List.js';
import { Panel } from '../components/chrome.js';
import { moveCursor, nav } from '../keys.js';
import { useStore } from '../store.js';

export const FILTERS_KEYS: [string, string][] = [
  ['o', 'add an only pattern'],
  ['x', 'add an exclude pattern'],
  ['d', 'delete the pattern'],
];

export const FILTERS_HINTS: [string, string][] = [
  ['o', 'add only'],
  ['x', 'add exclude'],
  ['d', 'delete'],
  ['?', 'keys'],
  ['esc', 'back'],
];

type Field = 'only' | 'exclude';
interface Entry {
  field: Field;
  pattern: string;
}

export function Filters({ index, height }: { index: number; height: number }): ReactNode {
  const store = useStore();
  const wire = store.wireAt(index);
  const artifacts = store.cached(wire)?.artifacts ?? [];
  const [cursor, setCursor] = useState(0);
  const [adding, setAdding] = useState<Field | null>(null);

  const entries: Entry[] = [
    ...(wire.only ?? []).map((pattern) => ({ field: 'only' as const, pattern })),
    ...(wire.exclude ?? []).map((pattern) => ({ field: 'exclude' as const, pattern })),
  ];
  const at = Math.min(cursor, Math.max(0, entries.length - 1));
  const counts = patternCounts(wire, artifacts);

  useKeys(
    (input, key) => {
      if (key.escape) return store.pop();
      const where = nav(input, key);
      if (where) {
        const next = moveCursor(where, at, entries.length, height - 2);
        if (next !== null) return setCursor(next);
        if (where === 'left') return store.pop();
        return;
      }
      if (input === 'o') return setAdding('only');
      if (input === 'x') return setAdding('exclude');
      if (input === 'd') {
        const e = entries[at];
        if (!e) return;
        const before = wire[e.field] ?? [];
        const gone = before.indexOf(e.pattern);
        void store.replaceWire(index, {
          ...wire,
          [e.field]: before.filter((_, i) => i !== gone),
        });
      }
    },
    { isActive: !adding && !store.help },
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Panel title="filters" subtitle={wire.name} grow>
        <List
          items={entries}
          cursor={at}
          height={height - 3}
          label="pattern"
          onPick={setCursor}
          empty="No patterns — everything in the source is selected."
          render={(e, here) => {
            const n = counts.get(e.pattern) ?? 0;
            return (
              <>
                <Cell width={10}>
                  <Text color={e.field === 'only' ? 'green' : 'yellow'} bold>
                    {e.field}
                  </Text>
                </Cell>
                <Cell width={38}>
                  <Text bold={here} {...rowColour(here)}>
                    {e.pattern}
                  </Text>
                </Cell>
                <Text {...rowColour(here, true)}>
                  {n} match{n === 1 ? '' : 'es'}
                </Text>
              </>
            );
          }}
        />
        {adding ? (
          <Box marginTop={1} flexShrink={0}>
            <Badge color={adding === 'only' ? 'green' : 'yellow'}>{adding}</Badge>
            <Text> </Text>
            <TextInput
              placeholder="pattern, e.g. skill:vendored-*"
              onSubmit={(value) => {
                const pattern = value.trim();
                setAdding(null);
                if (!pattern) return;
                void store.replaceWire(index, {
                  ...wire,
                  [adding]: [...(wire[adding] ?? []), pattern],
                });
              }}
            />
          </Box>
        ) : null}
      </Panel>
      <Box paddingX={1} flexShrink={0} flexDirection="column">
        <Text dimColor>
          only keeps what matches, exclude then removes. * is a wildcard, and a kind prefix
        </Text>
        <Text dimColor>scopes a pattern to it — skill:vendored-* leaves commands alone.</Text>
      </Box>
    </Box>
  );
}
