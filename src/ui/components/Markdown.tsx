import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

/**
 * Enough markdown to read a SKILL.md by.
 *
 * Not a parser: headings, list markers, fenced code and inline code and bold,
 * which is what these files are made of. A real markdown renderer would be a
 * dependency and a lot of behaviour for a panel whose job is to let you decide
 * whether you want the thing.
 */
export function Markdown({ text, width, lines }: { text: string; width: number; lines: number }) {
  const rendered: ReactNode[] = [];
  // Every line is its own unshrinkable row. Left shrinkable, Yoga squeezes
  // rows out of the middle when the block is taller than the space, which
  // reads as a file with lines missing from it rather than as one cut short.
  const row = (key: number, node: ReactNode): ReactNode => (
    <Box key={key} flexShrink={0}>
      {node}
    </Box>
  );
  let fenced = false;
  let blank = 0;

  for (const raw of text.split('\n')) {
    if (rendered.length >= lines) break;
    const line = raw.replace(/\t/g, '  ');

    if (line.trim().startsWith('```')) {
      fenced = !fenced;
      continue; // the fence itself says nothing worth a row
    }
    if (fenced) {
      rendered.push(
        row(
          rendered.length,
          <Text color="green" wrap="truncate-end">
            {'  '}
            {line}
          </Text>,
        ),
      );
      continue;
    }
    if (!line.trim()) {
      // One blank line between paragraphs, never a run of them.
      if (blank || !rendered.length) continue;
      blank = 1;
      rendered.push(row(rendered.length, <Text> </Text>));
      continue;
    }
    blank = 0;

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      rendered.push(
        row(
          rendered.length,
          <Text bold color={heading[1]!.length === 1 ? 'cyan' : undefined}>
            {wrapTo(heading[2]!, width)}
          </Text>,
        ),
      );
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      rendered.push(
        row(
          rendered.length,
          <Text dimColor>
            {bullet[1]}
            {'· '}
            {wrapTo(bullet[2]!, width - bullet[1]!.length - 2)}
          </Text>,
        ),
      );
      continue;
    }

    rendered.push(row(rendered.length, <Text dimColor>{wrapTo(line, width)}</Text>));
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {rendered}
    </Box>
  );
}

/** One row's worth, with the markers that would render as noise taken out. */
function wrapTo(s: string, width: number): string {
  const plain = s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*>\s?/, '');
  return plain.length > width ? `${plain.slice(0, Math.max(1, width - 1))}…` : plain;
}
