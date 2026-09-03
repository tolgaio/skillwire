import { measureElement, type DOMElement } from 'ink';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * Mouse support, which Ink does not provide.
 *
 * The terminal is asked to report clicks and wheel movement as escape
 * sequences; Ink hands each report to `useInput` whole, so they are parsed
 * here and never reach a screen as keystrokes. Regions register the rectangle
 * they occupy — measured, not calculated — and the topmost one containing the
 * click wins.
 *
 * The cost is real and worth stating: while tracking is on, the terminal sends
 * drags to the program instead of selecting text. Most terminals still select
 * if you hold shift (option on macOS), and `m` turns tracking off entirely.
 */

export interface MouseEvent {
  /** 0-based column and row of the cell under the pointer. */
  column: number;
  row: number;
  kind: 'press' | 'release' | 'wheelUp' | 'wheelDown';
  button: number;
}

/** SGR mouse report: ESC [ < button ; column ; row M|m, with the ESC eaten. */
const REPORT = /^\[<(\d+);(\d+);(\d+)([Mm])$/;

export function parseMouse(input: string): MouseEvent | null {
  const m = REPORT.exec(input);
  if (!m) return null;
  const button = Number(m[1]);
  const kind =
    button === 64 ? 'wheelUp' : button === 65 ? 'wheelDown' : m[4] === 'M' ? 'press' : 'release';
  // Reports are 1-based; everything measured here is 0-based.
  return { button: button & 3, column: Number(m[2]) - 1, row: Number(m[3]) - 1, kind };
}

const ESC = String.fromCharCode(27);
/** Button tracking, plus the SGR encoding that survives past column 223. */
export const ENABLE = `${ESC}[?1000h${ESC}[?1006h`;
export const DISABLE = `${ESC}[?1006l${ESC}[?1000l`;

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
  onClick?: () => void;
  onWheel?: (direction: -1 | 1) => void;
}

interface Registry {
  enabled: boolean;
  setEnabled(on: boolean): void;
  /** Called during layout; returns a function that removes the region again. */
  add(region: Region): () => void;
  dispatch(event: MouseEvent): boolean;
}

const Ctx = createContext<Registry | null>(null);

export function useMouse(): Registry {
  const registry = useContext(Ctx);
  if (!registry) throw new Error('useMouse outside the provider');
  return registry;
}

export function MouseProvider({
  children,
  enabled: initial = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}): ReactNode {
  const regions = useRef(new Set<Region>());
  const [enabled, setEnabled] = useState(initial);

  const registry = useMemo<Registry>(
    () => ({
      enabled,
      setEnabled,
      add(region) {
        regions.current.add(region);
        return () => regions.current.delete(region);
      },
      dispatch(event) {
        // Later registrations sit on top: a panel drawn over a list should get
        // the click, not the list underneath it.
        const hit = [...regions.current]
          .reverse()
          .find(
            (r) =>
              event.column >= r.x &&
              event.column < r.x + r.width &&
              event.row >= r.y &&
              event.row < r.y + r.height,
          );
        if (!hit) return false;
        if (event.kind === 'press' && hit.onClick) {
          hit.onClick();
          return true;
        }
        if ((event.kind === 'wheelUp' || event.kind === 'wheelDown') && hit.onWheel) {
          hit.onWheel(event.kind === 'wheelUp' ? -1 : 1);
          return true;
        }
        return false;
      },
    }),
    [enabled],
  );

  return <Ctx.Provider value={registry}>{children}</Ctx.Provider>;
}


/**
 * Register the rectangle a Box occupies, so a click on it can be routed back.
 *
 * Measured after every render rather than derived from the layout by hand:
 * positions move when the terminal resizes, a panel appears, or a list
 * scrolls, and a stale rectangle sends clicks to the wrong row.
 */
export function useRegion(handlers: {
  onClick?: () => void;
  onWheel?: (direction: -1 | 1) => void;
}): RefObject<DOMElement | null> {
  const registry = useMouse();
  const ref = useRef<DOMElement | null>(null);
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!ref.current || !registry.enabled) return;
    const { x, y, width, height } = measureElement(ref.current);
    if (!width || !height) return;
    return registry.add({
      x,
      y,
      width,
      height,
      onClick: () => latest.current.onClick?.(),
      onWheel: (d) => latest.current.onWheel?.(d),
    });
  });

  return ref;
}
