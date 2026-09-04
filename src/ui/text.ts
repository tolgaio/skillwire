/**
 * Text that has to occupy exactly one row.
 *
 * A description written as a YAML block scalar keeps its line breaks, and a
 * renderer draws every one of them: a single skill becomes six rows, the list
 * outgrows its window, and the panel border and the strip below it are pushed
 * off the screen. `wrap="truncate-end"` does not help — there is nothing to
 * truncate, the text genuinely is several lines.
 *
 * Runs of whitespace collapse too, so a wrapped paragraph reads as a sentence
 * rather than as a column of gaps.
 */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
