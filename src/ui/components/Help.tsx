import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

/** Keys every screen answers to, listed under whatever the screen adds. */
export const GLOBAL_KEYS: [string, string][] = [
  ['↑ ↓  k j', 'move'],
  ['← →  h l', 'back / into'],
  ['g  G', 'first / last'],
  ['^u  ^d', 'page up / down'],
  ['?', 'this list'],
  ['esc', 'back'],
  ['q', 'quit'],
];

/**
 * The key card.
 *
 * It takes the body rather than floating over it. Ink composites an absolutely
 * positioned subtree over what is already drawn and trims trailing whitespace
 * per line, so a floating card cannot cover the list underneath — the rows
 * show through its own padding. Taking the body is unambiguous, and it is what
 * every terminal UI with a `?` does anyway.
 */
export function Help({
  title,
  keys,
  width,
}: {
  title: string;
  keys: [string, string][];
  width: number;
}): ReactNode {
  const all = [...keys, ...GLOBAL_KEYS];
  const twoUp = width > 96 && all.length > 8;
  const half = Math.ceil(all.length / 2);
  const columns = twoUp ? [all.slice(0, half), all.slice(half)] : [all];
  const keyWidth = Math.max(...all.map(([k]) => k.length)) + 2;

  return (
    <Box flexGrow={1} justifyContent="center" alignItems="center">
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={1}
        width={Math.min(width - 8, twoUp ? 88 : 56)}
      >
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold color="cyan">
            {title}
          </Text>
          <Text dimColor>any key closes</Text>
        </Box>
        <Box>
          {columns.map((column, ci) => (
            <Box key={ci} flexDirection="column" flexGrow={1}>
              {column.map(([key, label]) => (
                <Box key={key + label} flexShrink={0}>
                  <Box width={keyWidth} flexShrink={0}>
                    <Text color="cyan">{key}</Text>
                  </Box>
                  <Text dimColor>{label}</Text>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
