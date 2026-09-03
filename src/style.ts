/**
 * ANSI styling, in one place so the CLI and the TUI agree.
 *
 * Disabled when the output is not a terminal, or when NO_COLOR is set — a
 * redirected `skillwire list` should be greppable, not full of escapes.
 */
const enabled =
  !process.env.NO_COLOR && (process.env.FORCE_COLOR === '1' || process.stdout.isTTY === true);

const wrap = (open: string, close = '\x1b[0m') => (s: string) => (enabled ? `${open}${s}${close}` : s);

export const c = {
  dim: wrap('\x1b[2m'),
  bold: wrap('\x1b[1m'),
  green: wrap('\x1b[32m'),
  yellow: wrap('\x1b[33m'),
  red: wrap('\x1b[31m'),
  cyan: wrap('\x1b[36m'),
  invert: wrap('\x1b[7m'),
  underline: wrap('\x1b[4m'),
};

/** Printable width, ignoring escape sequences. */
export function width(s: string): number {
  return stripAnsi(s).length;
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Every C0 control character except ESC, which starts a colour sequence.
 *
 * A newline inside a value — and a skill description written as a YAML block
 * scalar is often several lines — would turn one line of a frame into two rows
 * on screen. Everything drawn below it would then be one row out, and the
 * diffing redraw would keep painting over the wrong rows until the next resize.
 */
const CONTROL = /[\x00-\x1a\x1c-\x1f\x7f]/g;

/**
 * Cut a styled string to `n` printable columns, on exactly one row.
 *
 * Escape sequences are copied through without counting, so truncating a
 * coloured string cannot leave the terminal mid-colour: a reset is appended
 * whenever anything was dropped.
 */
export function truncate(raw: string, n: number): string {
  const s = raw.replace(CONTROL, ' ');
  if (width(s) <= n) return s;
  let out = '';
  let seen = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\x1b') {
      const end = s.indexOf('m', i);
      if (end !== -1) {
        out += s.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    if (seen >= n - 1) break;
    out += s[i];
    seen++;
  }
  return `${out}…\x1b[0m`;
}

export function pad(s: string, n: number): string {
  const w = width(s);
  return w >= n ? s : s + ' '.repeat(n - w);
}
