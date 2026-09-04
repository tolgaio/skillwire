import type { Key } from 'ink';

/**
 * Movement, resolved in one place.
 *
 * Ink hands `useInput` the raw character and a key object; every list resolves
 * movement through here so `j` and `↓` cannot drift apart between screens, and
 * so a text field can consult its own editor first — hjkl has to be typeable in
 * a path.
 */
export type Nav = 'up' | 'down' | 'left' | 'right' | 'top' | 'bottom' | 'pageUp' | 'pageDown';

export function nav(input: string, key: Key): Nav | null {
  if (key.ctrl) {
    if (input === 'b' || input === 'u') return 'pageUp';
    if (input === 'f' || input === 'd') return 'pageDown';
    return null;
  }
  if (key.upArrow || input === 'k') return 'up';
  if (key.downArrow || input === 'j') return 'down';
  if (key.leftArrow || input === 'h') return 'left';
  if (key.rightArrow || input === 'l') return 'right';
  if (key.pageUp) return 'pageUp';
  if (key.pageDown) return 'pageDown';
  if (input === 'g') return 'top';
  if (input === 'G') return 'bottom';
  return null;
}

/** Where a movement lands, given a list. Left and right are not distances. */
export function moveCursor(
  where: Nav,
  cursor: number,
  total: number,
  page: number,
): number | null {
  if (!total) return null;
  const clamp = (n: number): number => Math.max(0, Math.min(total - 1, n));
  switch (where) {
    case 'up':
      return clamp(cursor - 1);
    case 'down':
      return clamp(cursor + 1);
    case 'pageUp':
      return clamp(cursor - page);
    case 'pageDown':
      return clamp(cursor + page);
    case 'top':
      return 0;
    case 'bottom':
      return total - 1;
    default:
      return null; // left and right are for the screen to interpret
  }
}

/**
 * Where the window sits, given where it sat before.
 *
 * Sticky, not centred. A window centred on the cursor moves every row on
 * screen whenever the list changes length — opening a folder of two hundred
 * scrolled everything above it out from under the cursor. This only moves when
 * the cursor would otherwise leave it, which is what a text editor does and
 * what people expect.
 */
export function clampOffset(offset: number, cursor: number, total: number, height: number): number {
  const max = Math.max(0, total - height);
  let out = Math.min(Math.max(0, offset), max);
  if (cursor < out) out = cursor;
  if (cursor >= out + height) out = cursor - height + 1;
  return Math.max(0, Math.min(out, max));
}
