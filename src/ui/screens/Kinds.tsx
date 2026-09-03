import { Box, Text} from 'ink';
import { useKeys } from '../useKeys.js';
import { useState, type ReactNode } from 'react';
import { KINDS } from '../../artifact.js';
import type { Wire } from '../../config.js';
import { Check, List, rowColour } from '../components/List.js';
import { Panel } from '../components/chrome.js';
import { moveCursor, nav } from '../keys.js';
import { useStore } from '../store.js';

export const KINDS_KEYS: [string, string][] = [
  ['space', 'read this kind, or stop reading it'],
];

export const KINDS_HINTS: [string, string][] = [
  ['space', 'toggle'],
  ['?', 'keys'],
  ['esc', 'back'],
];

export function Kinds({ index }: { index: number }): ReactNode {
  const store = useStore();
  const wire = store.wireAt(index);
  const [cursor, setCursor] = useState(0);
  const on = new Set(wire.kinds ?? KINDS);

  useKeys((input, key) => {
    if (key.escape) return store.pop();
    const where = nav(input, key);
    if (where) {
      const next = moveCursor(where, cursor, KINDS.length, KINDS.length);
      if (next !== null) return setCursor(next);
      if (where === 'left') return store.pop();
      return;
    }
    if (input !== ' ') return;

    const kind = KINDS[cursor]!;
    const next = new Set(on);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    if (!next.size) return store.say('a source needs at least one kind', 'warn');

    const kinds = KINDS.filter((k) => next.has(k));
    const updated: Wire = { ...wire };
    if (kinds.length === KINDS.length) delete updated.kinds;
    else updated.kinds = kinds;
    void store.replaceWire(index, updated).then(() => {
      // The kind list decides what gets read, so what was read is now stale.
      store.invalidate(updated);
      void store.load(updated, false);
    });
  }, { isActive: !store.help });

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Panel title="kinds" subtitle={wire.name} grow>
        <List
          items={KINDS}
          cursor={cursor}
          height={KINDS.length}
          onPick={setCursor}
          render={(kind, here) => (
            <>
              <Check on={on.has(kind)} here={here} />
              <Text bold={here} {...rowColour(here)}>
                {' '}
                {kind}s
              </Text>
            </>
          )}
        />
      </Panel>
      <Box paddingX={1} flexShrink={0}>
        <Text dimColor>
          A kind left off is not read from the source at all, so it cannot be installed.
        </Text>
      </Box>
    </Box>
  );
}
