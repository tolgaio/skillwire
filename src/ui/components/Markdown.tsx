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
/**
 * The whole file as rows, so a caller can hold a scroll position over it.
 *
 * Built in full rather than up to a budget: the panel has to know how much
 * there is before it can say where in it you are.
 */
export function markdownRows(text: string, width: number): ReactNode[] {
  // Unkeyed: rows from several calls get concatenated, and numbering each
  // call from zero gave React duplicate keys — which it answers by reusing
  // elements, so one artifact's preview showed pieces of another's.
  const rendered: ReactNode[] = [];
  const row = (_key: number, node: ReactNode): ReactNode => node;
  let fenced = false;
  let blank = 0;

  for (const raw of text.split('\n')) {
    // A ceiling, not a viewport: a pathological file should not become a
    // hundred thousand React elements nobody will scroll to.
    if (rendered.length >= 4000) break;
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
      for (const part of wrapTo(heading[2]!, width)) {
        rendered.push(
          row(
            rendered.length,
            <Text bold color={heading[1]!.length === 1 ? 'cyan' : undefined}>
              {part}
            </Text>,
          ),
        );
      }
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const indent = `${bullet[1]}  `;
      wrapTo(bullet[2]!, width - indent.length).forEach((part, i) => {
        rendered.push(
          row(
            rendered.length,
            <Text dimColor>
              {i ? indent : `${bullet[1]}· `}
              {part}
            </Text>,
          ),
        );
      });
      continue;
    }

    for (const part of wrapTo(line, width)) {
      rendered.push(row(rendered.length, <Text dimColor>{part}</Text>));
    }
  }

  return rendered;
}

/** A window onto those rows. */
export function Markdown({
  rows,
  offset,
  lines,
}: {
  rows: ReactNode[];
  offset: number;
  lines: number;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {rows.slice(offset, offset + lines).map((node, i) => (
        // Keyed by where the row sits in the whole file, and unshrinkable:
        // left to shrink, a block taller than the panel has rows squeezed out
        // of its middle rather than its tail cut off.
        <Box key={offset + i} flexShrink={0}>
          {node}
        </Box>
      ))}
    </Box>
  );
}

/**
 * A line, as the rows it takes.
 *
 * Wrapped rather than cut: the panel is narrow, there is no scrolling, and a
 * sentence ending in an ellipsis every time says nothing. Long words break
 * rather than overflow.
 */
function wrapTo(s: string, width: number): string[] {
  const plain = s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*>\s?/, '');
  if (width < 4) return [plain];

  const out: string[] = [];
  let line = '';
  for (const word of plain.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
    while (line.length > width) {
      out.push(line.slice(0, width));
      line = line.slice(width);
    }
  }
  if (line || !out.length) out.push(line);
  return out;
}
