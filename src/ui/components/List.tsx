import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { windowOf } from '../keys.js';
import { useRegion } from '../mouse.js';

/**
 * The bar under the cursor.
 *
 * Grey, and it changes nothing else about the row. A bar strong enough to need
 * its own foreground takes the meaning out of the colours already there — a
 * green tick that has to be repainted black to stay readable is no longer
 * telling you anything. Grey sits close enough to a terminal's background that
 * every colour on the row survives it.
 *
 * `SKILLWIRE_HIGHLIGHT` overrides it with any colour name or hex Ink accepts,
 * because this is one guess about someone else's palette and a light-background
 * terminal will want a different one.
 */
export const HIGHLIGHT = process.env.SKILLWIRE_HIGHLIGHT || 'blackBright';

/**
 * Text on a row.
 *
 * Nothing is recoloured on the bar; secondary text only stops being dim, since
 * dim against a grey background is legible in theory and gone in practice.
 */
export function rowColour(here: boolean, secondary = false): { dimColor?: boolean } {
  return secondary && !here ? { dimColor: true } : {};
}

/**
 * A scrolling list.
 *
 * Ink lays out whatever it is handed, so passing five hundred rows would paint
 * five hundred rows and let the terminal scroll the top away. The list keeps a
 * window instead, and the cursor drags it along.
 */
export function List<T>({
  items,
  cursor,
  height,
  render,
  empty,
  label = 'item',
  countable,
  onPick,
  onScroll,
}: {
  items: T[];
  cursor: number;
  height: number;
  render: (item: T, selected: boolean) => ReactNode;
  empty?: string;
  label?: string;
  /** Which rows the position counter counts. Group headings are not rows. */
  countable?: (item: T) => boolean;
  /** A click on a row. */
  onPick?: (index: number) => void;
  /** The wheel, in rows. */
  onScroll?: (direction: -1 | 1) => void;
}): ReactNode {
  if (!items.length) {
    return (
      <Box>
        <Text dimColor>{empty ?? `no ${label}s`}</Text>
      </Box>
    );
  }

  const { slice, from } = windowOf(items, cursor, height);
  const more = items.length > height;
  const counts = countable ?? ((): boolean => true);
  const before = items.slice(0, from).filter(counts).length;
  const within = slice.filter(counts).length;
  const total = items.filter(counts).length;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {slice.map((item, i) => {
        const at = from + i;
        const here = at === cursor;
        return (
          // The row under the cursor is a bar across the whole panel, not a
          // marker at the start of it: in a list of five hundred near-identical
          // names, one arrow is not enough to find yourself by.
          <Row
            key={at}
            here={here}
            onPick={onPick && (() => onPick(at))}
            onScroll={onScroll}
          >
            {/* Fixed width, and unshrinkable: a row wider than the panel would
                otherwise have Yoga take the space back out of the marker and
                the checkbox rather than the text at the end. */}
            <Box width={2} flexShrink={0}>
              <Text color={here ? 'cyan' : undefined}>{here ? '▸' : ' '}</Text>
            </Box>
            {render(item, here)}
          </Row>
        );
      })}
      {more && within < total ? (
        <Box flexShrink={0}>
          <Text dimColor>
            {'  '}
            {before + 1}–{before + within} of {total}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** One row, and the rectangle a click on it lands in. */
function Row({
  here,
  onPick,
  onScroll,
  children,
}: {
  here: boolean;
  onPick?: () => void;
  onScroll?: (direction: -1 | 1) => void;
  children: ReactNode;
}): ReactNode {
  const ref = useRegion({ onClick: onPick, onWheel: onScroll });
  // No flexGrow. The parent is a column, so growing is vertical: the
  // highlighted row would take every spare line and paint half the panel.
  // A row already fills the width, because the cross axis stretches by default.
  return (
    <Box ref={ref} flexShrink={0} backgroundColor={here ? HIGHLIGHT : undefined}>
      {children}
    </Box>
  );
}

/** A checkbox, coloured by state rather than only shaped by it. */
export function Check({ on, here = false }: { on: boolean; here?: boolean }): ReactNode {
  if (on) return <Text color="green">[x]</Text>;
  return <Text {...rowColour(here, true)}>[ ]</Text>;
}

/** Fixed-width cell, so columns line up whatever is in them. */
export function Cell({
  width,
  children,
}: {
  width: number;
  children: ReactNode;
}): ReactNode {
  return (
    <Box width={width} flexShrink={0} overflow="hidden">
      {children}
    </Box>
  );
}

/** The last column: takes the rest of the row, and is the part that gets cut. */
export function Rest({ children }: { children: ReactNode }): ReactNode {
  return (
    <Box flexGrow={1} flexShrink={1} overflow="hidden">
      {children}
    </Box>
  );
}
