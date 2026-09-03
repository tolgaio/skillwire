import { useInput, type Key } from 'ink';
import { useEffect, useRef } from 'react';
import { parseMouse, useMouse } from './mouse.js';

/**
 * Handlers that also answer to a synthesised keypress.
 *
 * Clicking a key in the footer strip has to do what pressing it does. There is
 * no way to push a byte back into the terminal's stdin, so the key is
 * delivered to the same handlers Ink would have called.
 */
const listeners = new Set<(input: string, key: Key) => void>();

const BLANK_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
} as Key;

export function pressKey(input: string, over: Partial<Key> = {}): void {
  const key = { ...BLANK_KEY, ...over };
  for (const listener of [...listeners]) listener(input, key);
}

/**
 * `useInput`, with mouse reports taken out of the stream.
 *
 * The terminal sends clicks as escape sequences, and Ink hands each one to
 * every active input handler as a plain string like `[<0;12;5M`. Screens must
 * never see those — `[` would be a keypress and `M` another. Every screen uses
 * this instead of useInput, so a report is routed to whatever was clicked and
 * goes no further.
 */
export function useKeys(
  handler: (input: string, key: Key) => void,
  opts: { isActive?: boolean } = {},
): void {
  const active = opts.isActive !== false;
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!active) return;
    const listener = (input: string, key: Key): void => latest.current(input, key);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [active]);

  useInput(
    (input, key) => {
      // Swallowed, never acted on: useMouseDispatch does that, once. Every
      // active handler sees the same report, and a click that fired one action
      // per mounted screen would save the config twice over.
      if (parseMouse(input)) return;
      if (!active) return;
      handler(input, key);
    },
    // Always listening: a handler switched off with isActive would let mouse
    // reports through to whichever handler is still on, as keystrokes.
    { isActive: true },
  );
}

/**
 * Route mouse reports to whatever was clicked. Used once, by the root.
 *
 * Kept apart from useKeys because every mounted screen has one of those, and
 * they all see the same report.
 */
export function useMouseDispatch(): void {
  const mouse = useMouse();
  useInput((input) => {
    const event = parseMouse(input);
    if (event) mouse.dispatch(event);
  });
}
