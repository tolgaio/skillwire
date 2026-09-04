import { Badge } from '@inkjs/ui';
import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { useRegion } from '../mouse.js';

/**
 * A tab bar.
 *
 * Hand-built on Box and Text: Ink ships no tabs, `@inkjs/ui` has none, and the
 * one package that does declares Ink 4 to 6 against our 7. It is a row of
 * labels and an underline, which is less code than making an unsupported
 * dependency behave.
 */

export interface Tab {
  key: string;
  label: string;
  /** How much of this tab is picked, shown beside its name. */
  on?: number;
  of?: number;
  /** The tab's own colour, worn when it is the one you are looking at. */
  colour?: string;
}

export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: Tab[];
  active: string;
  onSelect: (key: string) => void;
}): ReactNode {
  if (tabs.length < 2) return null;
  return (
    <Box flexShrink={0} marginBottom={1}>
      {tabs.map((tab, i) => (
        <TabLabel
          key={tab.key}
          tab={tab}
          index={i}
          active={tab.key === active}
          onSelect={() => onSelect(tab.key)}
        />
      ))}
    </Box>
  );
}

/**
 * One tab.
 *
 * The open one is filled with its own colour and the rest are dim text, which
 * is the whole of what makes a row of words read as tabs — a page you are on
 * and pages you are not.
 */
function TabLabel({
  tab,
  index,
  active,
  onSelect,
}: {
  tab: Tab;
  index: number;
  active: boolean;
  onSelect: () => void;
}): ReactNode {
  const ref = useRegion({ onClick: onSelect });
  const count = tab.of === undefined ? '' : ` ${tab.on}/${tab.of}`;
  return (
    <Box ref={ref} marginRight={1}>
      {active ? (
        <Badge color={tab.colour ?? 'cyan'}>
          {tab.label}
          {count}
        </Badge>
      ) : (
        <Text dimColor>
          {' '}
          {index + 1} {tab.label}
          {count}{' '}
        </Text>
      )}
    </Box>
  );
}

/** Where a key lands in a tab bar, or null when it is not about tabs. */
export function tabFor(
  input: string,
  key: { tab?: boolean; shift?: boolean },
  tabs: Tab[],
  active: string,
): string | null {
  if (!tabs.length) return null;
  const at = Math.max(0, tabs.findIndex((t) => t.key === active));
  if (key.tab) {
    const next = key.shift ? at - 1 + tabs.length : at + 1;
    return tabs[next % tabs.length]!.key;
  }
  // Digits jump straight there, the way a numbered list invites.
  if (/^[1-9]$/.test(input)) return tabs[Number(input) - 1]?.key ?? null;
  return null;
}
