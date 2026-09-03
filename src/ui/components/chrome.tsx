import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useRegion } from '../mouse.js';

/**
 * The frame around every screen.
 *
 * All of it is flexbox: `flexGrow` on the middle row is what makes the list
 * take whatever the header and footer leave, at any terminal size, without a
 * single row calculation.
 */

export function Header({
  crumbs,
  status,
  onCrumb,
}: {
  crumbs: string[];
  status?: string;
  /** Click a crumb to go back to that depth. */
  onCrumb?: (depth: number) => void;
}): ReactNode {
  return (
    <Box
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
      flexShrink={0}
    >
      <Box>
        <Text bold color="cyan">
          skillwire
        </Text>
        {crumbs.map((crumb, i) => (
          <Box key={`${i}-${crumb}`}>
            <Text dimColor> › </Text>
            <Clickable onClick={onCrumb && i < crumbs.length - 1 ? () => onCrumb(i) : undefined}>
              <Text bold={i === crumbs.length - 1} dimColor={i !== crumbs.length - 1}>
                {crumb}
              </Text>
            </Clickable>
          </Box>
        ))}
      </Box>
      {status ? <Text dimColor>{status}</Text> : null}
    </Box>
  );
}

/**
 * The key strip, and a line for whatever just happened.
 *
 * Keys are `[key, label]` pairs rather than pre-joined text so the key itself
 * can be highlighted — the thing you press should be findable at a glance.
 */
export function Footer({
  hints,
  note,
  onHint,
}: {
  hints: [string, string][];
  note?: ReactNode;
  /** Click a hint to press the key it advertises. */
  onHint?: (key: string) => void;
}): ReactNode {
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box height={1}>{note ?? null}</Box>
      <Box paddingX={1} flexWrap="wrap">
        {hints.map(([key, label]) => (
          <Clickable key={key + label} onClick={onHint ? () => onHint(key) : undefined}>
            <Box marginRight={2}>
              <Text color="cyan">{key}</Text>
              <Text dimColor> {label}</Text>
            </Box>
          </Clickable>
        ))}
      </Box>
    </Box>
  );
}

/**
 * A box that answers to the mouse.
 *
 * Without an onClick it is a plain Box, so nothing pays for the region
 * bookkeeping unless something is actually clickable.
 */
export function Clickable({
  onClick,
  children,
}: {
  onClick?: () => void;
  children: ReactNode;
}): ReactNode {
  const ref = useRegion({ onClick });
  return <Box ref={onClick ? ref : undefined}>{children}</Box>;
}

/** A titled panel. Used for the list, the detail side panel and the help. */
export function Panel({
  title,
  subtitle,
  children,
  width,
  grow,
  colour,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: number | string;
  grow?: boolean;
  colour?: string;
}): ReactNode {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colour ?? 'gray'}
      paddingX={1}
      width={width}
      flexGrow={grow ? 1 : 0}
      // A panel given a width keeps it: without this the flex row steals it
      // back for whatever is growing beside it.
      flexShrink={width === undefined ? 1 : 0}
      overflow="hidden"
    >
      <Box flexShrink={0}>
        <Text bold color={colour}>
          {title}
        </Text>
        {subtitle ? <Text dimColor> {subtitle}</Text> : null}
      </Box>
      {children}
    </Box>
  );
}

/** A row of `label  value`, for the detail panel and the form. */
export function Row({
  label,
  children,
  width = 12,
}: {
  label: string;
  children: ReactNode;
  width?: number;
}): ReactNode {
  return (
    <Box flexShrink={0}>
      <Box width={width} flexShrink={0}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box flexGrow={1}>{children}</Box>
    </Box>
  );
}

/** How much of a long list fits, once the chrome has taken its share. */
export function listHeight(rows: number, extra = 0): number {
  // header 3, footer 3, the panel's own border 2, and whatever the screen adds.
  return Math.max(1, rows - 8 - extra);
}
