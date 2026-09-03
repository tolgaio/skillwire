import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Artifact } from '../artifact.js';
import { saveConfig, type Config, type Wire } from '../config.js';
import { message, readWire, run, type RunOptions } from '../run.js';

/**
 * Everything the screens share.
 *
 * The config file is the only state that outlives the process: every change is
 * written straight back, so quitting and running `skillwire install` does
 * exactly what the screen said. What lives here is the rest — which screen you
 * are on, what has been read from each source, and what just happened.
 */

/** What a source turned out to hold, once read. */
export interface Loaded {
  artifacts: Artifact[];
  sourceName: string;
  error?: string;
}

export type Route =
  | { screen: 'sources' }
  | { screen: 'browse'; wire: number }
  | { screen: 'filters'; wire: number }
  | { screen: 'kinds'; wire: number }
  | { screen: 'form'; wire: number | null }
  | { screen: 'install'; wire: number; dryRun: boolean };

export type Runner = (
  config: Config,
  opts: RunOptions,
  log: (line: string) => void,
) => Promise<number>;

export interface Note {
  text: string;
  tone: 'ok' | 'warn' | 'error';
}

export interface Store {
  config: Config;
  configPath: string;
  route: Route;
  crumbs: string[];
  loaded: Map<string, Loaded>;
  busy: string | null;
  note: Note | null;
  /** Lines from the install currently on screen, and whether it is still going. */
  log: string[];
  running: boolean;
  /**
   * Whether the key card is up.
   *
   * Every screen stands its input down while it is: two active useInput hooks
   * both see the key that closes the card, and the screen would act on it.
   */
  help: boolean;
  setHelp(open: boolean): void;

  push(route: Route): void;
  pop(): void;
  /** Back to a depth in the breadcrumb, for a click on one. */
  popTo(depth: number): void;
  say(text: string, tone?: Note['tone']): void;

  wireAt(index: number): Wire;
  cached(wire: Wire): Loaded | undefined;
  load(wire: Wire, fetch: boolean): Promise<Loaded>;
  invalidate(wire: Wire): void;

  replaceWire(index: number, wire: Wire): Promise<void>;
  addWire(wire: Wire): Promise<void>;
  removeWire(index: number): Promise<void>;

  install(index: number, dryRun: boolean): Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('useStore outside the provider');
  return store;
}

export function StoreProvider({
  initialConfig,
  configPath,
  noFetch,
  runner = run,
  children,
}: {
  initialConfig: Config;
  configPath: string;
  noFetch?: boolean;
  runner?: Runner;
  children: ReactNode;
}): ReactNode {
  const [config, setConfig] = useState(initialConfig);
  const [stack, setStack] = useState<Route[]>([{ screen: 'sources' }]);
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [help, setHelp] = useState(false);

  const route = stack[stack.length - 1]!;

  const say = useCallback((text: string, tone: Note['tone'] = 'ok') => {
    setNote({ text, tone });
  }, []);

  const push = useCallback((next: Route) => {
    setNote(null);
    setStack((s) => [...s, next]);
  }, []);

  const pop = useCallback(() => {
    setNote(null);
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const popTo = useCallback((depth: number) => {
    setNote(null);
    setStack((s) => (depth >= 0 && depth < s.length - 1 ? s.slice(0, depth + 1) : s));
  }, []);

  const write = useCallback(
    async (next: Config) => {
      setConfig(next);
      await saveConfig(next, configPath);
      say('saved');
    },
    [configPath, say],
  );

  const load = useCallback(
    async (wire: Wire, fetch: boolean): Promise<Loaded> => {
      setBusy(`${fetch ? 'fetching' : 'reading'} ${wire.name}`);
      let result: Loaded;
      try {
        const { artifacts, sourceName } = await readWire(wire, {
          fetch: fetch && !noFetch,
          onProgress: (m) => setBusy(m),
        });
        result = { artifacts, sourceName };
      } catch (err) {
        result = { artifacts: [], sourceName: wire.name, error: message(err) };
      }
      setBusy(null);
      setLoaded((m) => new Map(m).set(wire.name, result));
      return result;
    },
    [noFetch],
  );

  const store = useMemo<Store>(() => {
    const wireAt = (index: number): Wire => config.wires[index]!;
    return {
      config,
      configPath,
      route,
      crumbs: crumbsFor(stack, config),
      loaded,
      busy,
      note,
      log,
      running,
      help,
      setHelp,
      push,
      pop,
      popTo,
      say,
      wireAt,
      cached: (wire) => loaded.get(wire.name),
      load,
      invalidate: (wire) =>
        setLoaded((m) => {
          const next = new Map(m);
          next.delete(wire.name);
          return next;
        }),
      replaceWire: (index, wire) =>
        write({ ...config, wires: config.wires.map((w, i) => (i === index ? wire : w)) }),
      addWire: (wire) => write({ ...config, wires: [...config.wires, wire] }),
      removeWire: async (index) => {
        const gone = config.wires[index];
        if (gone)
          setLoaded((m) => {
            const next = new Map(m);
            next.delete(gone.name);
            return next;
          });
        await write({ ...config, wires: config.wires.filter((_, i) => i !== index) });
      },

      /**
       * Install, always with --prune.
       *
       * What is ticked is the whole of what this source should have installed,
       * so an install that only ever added would leave everything you unticked
       * in place and make the checkboxes a description of nothing.
       *
       * The output streams into a panel rather than dropping out of the UI —
       * Ink renders in place, so there is nothing to suspend.
       */
      install: async (index, dryRun) => {
        const wire = wireAt(index);
        setLog([]);
        setRunning(true);
        setStack((s) => [...s, { screen: 'install', wire: index, dryRun }]);
        let code = 1;
        try {
          code = await runner(
            config,
            { wires: [wire.name], dryRun, prune: true, noFetch: true },
            (line) => setLog((l) => [...l, line]),
          );
        } catch (err) {
          setLog((l) => [...l, message(err)]);
        }
        setRunning(false);
        say(
          code === 0
            ? dryRun
              ? `dry run finished for ${wire.name}`
              : `installed ${wire.name}`
            : `${wire.name} finished with errors`,
          code === 0 ? 'ok' : 'error',
        );
      },
    };
  }, [config, configPath, route, stack, loaded, busy, note, log, running, help, push, pop, popTo, say, load, write, runner]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

function crumbsFor(stack: Route[], config: Config): string[] {
  return stack.map((r) => {
    switch (r.screen) {
      case 'sources':
        return 'sources';
      case 'browse':
        return config.wires[r.wire]?.name ?? '?';
      case 'filters':
        return 'filters';
      case 'kinds':
        return 'kinds';
      case 'form':
        return r.wire === null ? 'add' : 'edit';
      case 'install':
        return r.dryRun ? 'dry run' : 'install';
    }
  });
}
