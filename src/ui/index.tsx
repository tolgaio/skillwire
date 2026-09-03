import { render } from 'ink';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_NAMES, loadConfig, type Config } from '../config.js';
import { message } from '../run.js';
import { App } from './App.js';
import { MouseProvider } from './mouse.js';
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

  await waitUntilExit();
  return 0;
}
