#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { buildSource, buildTarget, loadConfig, type Wire } from './config.js';
import { KINDS, type Artifact, type Kind } from './artifact.js';
import { selectArtifacts } from './filter.js';
import { previouslyInstalled, readManifest, record, writeManifest } from './manifest.js';
import type { Target } from './targets/base.js';

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
};

const USAGE = `
${c.bold('skillwire')} — push Agent Skills from one source into every agent that can use them

  skillwire install [--dry-run] [--prune] [--wire <name>] [--target <id>]
  skillwire list                    show skills each wire would install
  skillwire targets                 show which targets are present on this machine

Options
  -c, --config <path>   config file (default: ./skillwire.config.json)
  -V, --version         print the version and exit
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
    else rest.push(v);
  }
  if (rest[0]) a.cmd = rest[0];
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

  let failed = false;
  let manifest = await readManifest();

  for (const wire of wires) {
    const source = buildSource(wire.source);
    let sourceRoot: string;
    try {
      sourceRoot = await source.prepare({
        fetch: !args.noFetch,
        onProgress: (m) => console.log(`\n${c.bold(wire.name)}  ${c.dim(m)}`),
      });
    } catch (err) {
      failed = true;
      console.log(
        `\n${c.bold(wire.name)}  ${c.red('fail')}  ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    const all = await source.read(wire.kinds ?? KINDS);
    let skills = selectArtifacts(all, wire);
    if (args.kinds.length) skills = skills.filter((s) => args.kinds.includes(s.kind));
    // After filtering, so patterns match ids as they appear in the repo.
    if (wire.prefix) {
      const pre = wire.prefix.replace(/-+$/, '');
      skills = skills.map((s) => ({ ...s, id: `${pre}-${s.id}` }));
    }

    console.log(
      `\n${c.bold(wire.name)}  ${c.dim(source.name)}  ${skills.length} item${skills.length === 1 ? '' : 's'}` +
        (skills.length !== all.length ? c.dim(` (of ${all.length})`) : ''),
    );

    if (args.cmd === 'list') {
      for (const kind of KINDS) {
        const of = skills.filter((s) => s.kind === kind);
        if (!of.length) continue;
        console.log(`  ${c.dim(kind + 's')}`);
        for (const s of of) {
          const group = s.group ? c.dim(`${s.group}/`) : '';
          console.log(`    ${group}${s.id}  ${c.dim(`${s.files.length} file${s.files.length === 1 ? '' : 's'}`)}`);
        }
      }
      continue;
    }

    if (args.cmd !== 'install') {
      console.error(c.red(`unknown command "${args.cmd}"`));
      return 1;
    }

    for (const tc of wire.targets) {
      const target = buildTarget(tc);
      if (args.targets.length && !args.targets.includes(target.id)) continue;

      if (!(await target.detect())) {
        console.log(`  ${c.dim('skip')}    ${target.id}  ${c.dim('not present on this machine')}`);
        continue;
      }

      try {
        const res = await target.install(skills, {
          dryRun: args.dryRun,
          prune: args.prune,
          previouslyInstalled: previouslyInstalled(manifest, wire.name, target.id),
          sourceRoot,
        });
        // Record what this wire now owns at this target, so a later run can
        // prune artifacts it stops producing — including ones whose ids changed
        // because a prefix was added or the layout moved.
        if (!args.dryRun) {
          const owned = skills
            .filter((a) => target.kinds.includes(a.kind))
            .map((a) => `${a.kind}:${a.id}`);
          manifest = record(manifest, wire.name, target.id, owned);
        }
        const verb = args.dryRun ? c.yellow('would') : c.green('ok   ');
        console.log(`  ${verb}    ${target.id}  ${res.installed.length} installed`);
        for (const s of res.skipped) {
          console.log(`          ${c.yellow('!')} ${s.id}: ${s.reason}`);
        }
      } catch (err) {
        failed = true;
        console.log(
          `  ${c.red('fail')}    ${target.id}  ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (!args.dryRun) await writeManifest(manifest);

  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(c.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  },
);
