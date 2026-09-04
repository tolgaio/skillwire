import { render } from 'ink';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_NAMES, loadConfig, type Config } from '../config.js';
import { message } from '../run.js';
import { App } from './App.js';
import { DISABLE, MouseProvider } from './mouse.js';
import { StoreProvider, type Runner } from './store.js';

/** Where a config should be created when there is none yet. */
export function defaultConfigPath(): string {
  return join(homedir(), '.config', 'skillwire', CONFIG_NAMES[0]!);
}

export async function interactive(opts: {
  configPath?: string;
  noFetch?: boolean;
  runner?: Runner;
}): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      'the interactive UI needs a terminal — run skillwire without redirecting its output',
    );
    return 1;
  }

  let config: Config;
  let path: string;
  try {
    ({ config, path } = await loadConfig(opts.configPath));
  } catch (err) {
    // No config yet is the normal first run, not a failure: start empty and
    // write the file the moment there is something to put in it.
    if (!/no config found/.test(message(err))) throw err;
    config = { wires: [] };
    path = opts.configPath ?? defaultConfigPath();
  }

  // Whatever happens in here, the terminal has to come back. Mouse tracking
  // left on sends escape sequences to the next program that runs, and a raw
  // terminal with no cursor is one a person cannot type into — which is a far
  // worse outcome than the error that caused it.
  const restore = (): void => {
    try {
      process.stdout.write(DISABLE);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {
      /* going down anyway */
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, () => {
      restore();
      process.exit(130);
    });
  }
  process.once('uncaughtException', (err) => {
    restore();
    console.error(`\nskillwire hit an error and had to stop:\n${message(err)}\n`);
    process.exit(1);
  });
  process.once('unhandledRejection', (err) => {
    restore();
    console.error(`\nskillwire hit an error and had to stop:\n${message(err)}\n`);
    process.exit(1);
  });

  const { waitUntilExit } = render(
    <MouseProvider>
      <StoreProvider
        initialConfig={config}
        configPath={path}
        noFetch={opts.noFetch}
        runner={opts.runner}
      >
        <App />
      </StoreProvider>
    </MouseProvider>,
    // The UI owns the whole screen while it runs; leaving the scrollback as it
    // was on exit is what makes it something people are willing to open.
    { exitOnCtrlC: true, patchConsole: true },
  );

  try {
    await waitUntilExit();
  } finally {
    restore();
  }
  return 0;
}
