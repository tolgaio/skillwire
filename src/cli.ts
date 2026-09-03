#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { buildTarget, loadConfig } from './config.js';
import { type Kind } from './artifact.js';
import { message, run } from './run.js';
import { c } from './style.js';
import type { Target } from './targets/base.js';

const USAGE = `
${c.bold('skillwire')} — push Agent Skills from one source into every agent that can use them

  skillwire install [--dry-run] [--prune] [--wire <name>] [--target <id>]
  skillwire list                    show skills each wire would install
  skillwire targets                 show which targets are present on this machine
  skillwire interactive             browse sources and pick artifacts in a terminal UI

Options
  -c, --config <path>   config file (default: ./skillwire.config.json)
  -V, --version         print the version and exit
  -i, --interactive     open the terminal UI
      --kind <k>        only this kind: skill | command | agent (repeatable)
      --wire <name>     only this wire (repeatable)
      --target <id>     only this target (repeatable)
      --dry-run         report what would happen, write nothing
      --prune           remove artifacts this wire installed and no longer produces
      --no-fetch        use the cached clone of a git source without updating it
`;

interface Args {
  cmd: string;
  config?: string;
  wires: string[];
  targets: string[];
  kinds: Kind[];
  dryRun: boolean;
  noFetch: boolean;
  prune: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    cmd: 'help',
    wires: [],
    targets: [],
    kinds: [],
    dryRun: false,
    prune: false,
    noFetch: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--prune') a.prune = true;
    else if (v === '--no-fetch') a.noFetch = true;
    else if (v === '--wire') a.wires.push(argv[++i]!);
    else if (v === '--target') a.targets.push(argv[++i]!);
    else if (v === '--kind') a.kinds.push(argv[++i]! as Kind);
    else if (v === '-c' || v === '--config') a.config = argv[++i]!;
    else if (v === '-h' || v === '--help') a.cmd = 'help';
    else if (v === '-V' || v === '--version') a.cmd = 'version';
    else if (v === '-i' || v === '--interactive') a.cmd = 'interactive';
    else rest.push(v);
  }
  // A flag beats a bare command, so `skillwire list -i` opens the UI rather
  // than silently ignoring the flag.
  if (rest[0] && a.cmd === 'help') a.cmd = rest[0];
  return a;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === 'help') {
    console.log(USAGE);
    return 0;
  }

  if (args.cmd === 'version') {
    // Read at runtime rather than baked in at build, so the reported version
    // cannot drift from the package that is actually installed.
    const pkg = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    console.log(pkg.version);
    return 0;
  }

  if (args.cmd === 'interactive') {
    // Imported here so the common path does not pay for the UI, and so a
    // terminal-only module is never loaded when there is no terminal.
    const { interactive } = await import('./ui/index.js');
    return interactive({ configPath: args.config, noFetch: args.noFetch });
  }

  const { config, path } = await loadConfig(args.config);
  const wires = args.wires.length
    ? config.wires.filter((w) => args.wires.includes(w.name))
    : config.wires;

  if (!wires.length) {
    console.error(c.red(`no matching wires in ${path}`));
    return 1;
  }

  if (args.cmd === 'targets') {
    const seen = new Map<string, Target>();
    for (const w of wires)
      for (const t of w.targets) {
        const target = buildTarget(t);
        seen.set(target.id, target);
      }
    for (const t of seen.values()) {
      const ok = await t.detect();
      console.log(`  ${ok ? c.green('present') : c.dim('absent ')}  ${t.id}  ${c.dim(t.name)}`);
    }
    return 0;
  }

  if (args.cmd !== 'install' && args.cmd !== 'list') {
    console.error(c.red(`unknown command "${args.cmd}"`));
    return 1;
  }

  return run(
    config,
    {
      wires: args.wires,
      targets: args.targets,
      kinds: args.kinds,
      dryRun: args.dryRun,
      prune: args.prune,
      noFetch: args.noFetch,
      listOnly: args.cmd === 'list',
    },
    (line) => console.log(line),
  );
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(c.red(message(err)));
    process.exit(1);
  },
);
