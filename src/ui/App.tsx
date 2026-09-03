import { Spinner } from '@inkjs/ui';
import { Box, Text, useApp, useStdout, useWindowSize } from 'ink';
import { useEffect, type ReactNode } from 'react';
import { DISABLE, ENABLE, useMouse } from './mouse.js';
import { pressKey, useKeys, useMouseDispatch } from './useKeys.js';
import { Footer, Header, listHeight } from './components/chrome.js';
import { Help } from './components/Help.js';
import { Browse, BROWSE_HINTS, BROWSE_KEYS } from './screens/Browse.js';
import { Filters, FILTERS_HINTS, FILTERS_KEYS } from './screens/Filters.js';
import { Form, FORM_HINTS, FORM_KEYS } from './screens/Form.js';
import { Install, INSTALL_HINTS, INSTALL_KEYS } from './screens/Install.js';
import { Kinds, KINDS_HINTS, KINDS_KEYS } from './screens/Kinds.js';
import { Sources, SOURCES_HINTS, SOURCES_KEYS } from './screens/Sources.js';
import { useStore } from './store.js';

/**
 * The shell: header, screen, footer, and the help overlay above all of it.
 *
 * Nothing here computes a row number. The middle box grows into whatever the
 * header and footer leave, at any terminal size, and re-lays itself out on
 * resize — which is most of why this is worth a framework.
 */
export function App(): ReactNode {
  const store = useStore();
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { columns: width, rows: height } = useWindowSize();
  const mouse = useMouse();
  const help = store.help;
  useMouseDispatch();

  /**
   * Ask the terminal to report clicks, and stop asking on the way out.
   *
   * Leaving tracking on would have the terminal keep sending escape sequences
   * to whatever runs next, which looks like a possessed shell.
   */
  useEffect(() => {
    // Straight to the terminal, and only a real one: these are terminal modes,
    // not output, and writing them through Ink's stream mixes them into the
    // frame it is drawing.
    if (!process.stdout.isTTY) return;
    if (!mouse.enabled) {
      stdout.write(DISABLE);
      return;
    }
    stdout.write(ENABLE);
    const off = (): void => {
      stdout.write(DISABLE);
    };
    process.on('exit', off);
    return () => {
      off();
      process.off('exit', off);
    };
  }, [mouse.enabled, stdout]);

  const route = store.route;
  const keys = KEYS[route.screen] ?? [];
  const hints = HINTS[route.screen] ?? [];

  // `?` is answered here, and any key closes the card. Screens check the same
  // flag and stand down, so the key that closes it does not also act.
  useKeys((input, key) => {
    if (help) return store.setHelp(false);
    if (input === '?') store.setHelp(true);
    else if (input === 'm') {
      mouse.setEnabled(!mouse.enabled);
      store.say(
        mouse.enabled
          ? 'mouse off — the terminal selects text again'
          : 'mouse on — hold shift to select text',
      );
    } else if (key.ctrl && input === 'c') exit();
  });

  // Read what is on disk before the first list is drawn, so counts are real
  // rather than dashes. No fetching — that is a keypress away.
  useEffect(() => {
    void (async () => {
      for (const wire of store.config.wires) {
        if (!store.cached(wire)) await store.load(wire, false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const body = listHeight(height);

  return (
    <Box flexDirection="column" height={height} width={width}>
      <Header crumbs={store.crumbs} status={statusFor(store)} onCrumb={store.popTo} />

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {help ? (
          <Help title={store.crumbs[store.crumbs.length - 1] ?? 'keys'} keys={keys} width={width} />
        ) : (
          <Screen height={body} width={width} onQuit={exit} />
        )}
      </Box>

      <Footer hints={hints} note={<Note />} onHint={press} />
    </Box>
  );
}

/**
 * Turn a footer hint back into the key it advertises.
 *
 * The strip says what to press; clicking it should press that, not open a
 * parallel path to the same action that can drift from the keyboard one.
 */
function press(hint: string): void {
  switch (hint) {
    case '⏎':
      return pressKey('', { return: true });
    case 'esc':
      return pressKey('', { escape: true });
    case 'space':
      return pressKey(' ');
    case '^s':
      return pressKey('s', { ctrl: true });
    case '←→':
    case '↑↓':
      return; // movement is what the mouse is for
    default:
      if (hint.length === 1) pressKey(hint);
  }
}

function Screen({
  height,
  width,
  onQuit,
}: {
  height: number;
  width: number;
  onQuit: () => void;
}): ReactNode {
  const store = useStore();
  const route = store.route;
  switch (route.screen) {
    case 'sources':
      return <Sources height={height} width={width} onQuit={onQuit} />;
    case 'browse':
      return <Browse index={route.wire} height={height} width={width} />;
    case 'filters':
      return <Filters index={route.wire} height={height} />;
    case 'kinds':
      return <Kinds index={route.wire} />;
    case 'form':
      return <Form index={route.wire} />;
    case 'install':
      return <Install index={route.wire} dryRun={route.dryRun} height={height} />;
  }
}

/**
 * One line, always one line.
 *
 * A bordered Alert belongs where there is room for it; in a strip above the
 * keys it would be clipped to its top border and the message would vanish.
 */
const TONE = {
  ok: { mark: '✓', colour: 'green' },
  warn: { mark: '▲', colour: 'yellow' },
  error: { mark: '✖', colour: 'red' },
} as const;

function Note(): ReactNode {
  const store = useStore();
  if (store.busy) {
    return (
      <Box paddingX={1}>
        {/* Spinner renders a Box, so it cannot live inside a Text. */}
        <Spinner label={store.busy} />
      </Box>
    );
  }
  if (!store.note) return <Text> </Text>;
  const tone = TONE[store.note.tone];
  return (
    <Box paddingX={1}>
      <Text color={tone.colour}>{tone.mark} </Text>
      <Text dimColor={store.note.tone === 'ok'} wrap="truncate-end">
        {store.note.text}
      </Text>
    </Box>
  );
}

function statusFor(store: ReturnType<typeof useStore>): string {
  const route = store.route;
  if (route.screen === 'sources') {
    const n = store.config.wires.length;
    return `${n} source${n === 1 ? '' : 's'}`;
  }
  if ('wire' in route && route.wire !== null) {
    const wire = store.config.wires[route.wire];
    const cached = wire && store.cached(wire);
    if (wire && cached) return `${wire.name} · ${cached.artifacts.length} artifacts`;
    return wire?.name ?? '';
  }
  return '';
}

const KEYS: Record<string, [string, string][]> = {
  sources: SOURCES_KEYS,
  browse: BROWSE_KEYS,
  filters: FILTERS_KEYS,
  kinds: KINDS_KEYS,
  form: FORM_KEYS,
  install: INSTALL_KEYS,
};

const HINTS: Record<string, [string, string][]> = {
  sources: SOURCES_HINTS,
  browse: BROWSE_HINTS,
  filters: FILTERS_HINTS,
  kinds: KINDS_HINTS,
  form: FORM_HINTS,
  install: INSTALL_HINTS,
};
