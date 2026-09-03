import { Spinner, StatusMessage } from '@inkjs/ui';
import { Box, Static, Text} from 'ink';
import { useKeys } from '../useKeys.js';
import type { ReactNode } from 'react';
import { Panel } from '../components/chrome.js';
import { useStore } from '../store.js';

export const INSTALL_KEYS: [string, string][] = [['⏎  esc', 'back to the list']];
export const INSTALL_HINTS: [string, string][] = [['⏎', 'back']];

/**
 * The install, running inside the UI.
 *
 * Ink renders in place rather than on an alternate screen, so there is nothing
 * to suspend and drop out of: the same output `skillwire install` prints
 * streams into a panel here, and `<Static>` keeps already-printed lines out of
 * the re-render on every new one.
 */
export function Install({
  dryRun,
  index,
  height,
}: {
  dryRun: boolean;
  index: number;
  height: number;
}): ReactNode {
  const store = useStore();
  const wire = store.wireAt(index);

  useKeys((_input, key) => {
    if (store.running) return;
    if (key.return || key.escape) store.pop();
  }, { isActive: !store.help });

  const shown = store.log.slice(-Math.max(4, height - 4));

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Panel
        title={dryRun ? 'dry run' : 'install'}
        subtitle={`${wire.name} — with --prune`}
        colour={dryRun ? 'yellow' : 'green'}
        grow
      >
        <Static items={store.log.length > shown.length ? [] : []}>{() => null}</Static>
        {shown.map((line, i) => (
          <Text key={`${i}-${line}`}>{line}</Text>
        ))}
        {store.running ? (
          <Box marginTop={1}>
            <Spinner label={dryRun ? 'working out what would change' : 'installing'} />
          </Box>
        ) : (
          <Box marginTop={1}>
            <StatusMessage variant="success">
              {dryRun ? 'nothing was written' : 'done'}
            </StatusMessage>
          </Box>
        )}
      </Panel>
    </Box>
  );
}
