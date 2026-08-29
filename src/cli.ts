#!/usr/bin/env node
import { buildSource, buildTarget, expandPath, loadConfig, type Wire } from './config.js';
import { KINDS, type Artifact, type Kind } from './artifact.js';
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
      --kind <k>        only this kind: skill | command | agent (repeatable)
      --wire <name>     only this wire (repeatable)
      --target <id>     only this target (repeatable)
      --dry-run         report what would happen, write nothing
      --prune           remove skills at the target that are absent from the source
`;

interface Args {
  cmd: string;
  config?: string;
  wires: string[];
  targets: string[];
  kinds: Kind[];
  dryRun: boolean;
  prune: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: 'help', wires: [], targets: [], kinds: [], dryRun: false, prune: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === '--dry-run') a.dryRun = true;
    else if (v === '--prune') a.prune = true;
    else if (v === '--wire') a.wires.push(argv[++i]!);
    else if (v === '--target') a.targets.push(argv[++i]!);
    else if (v === '--kind') a.kinds.push(argv[++i]! as Kind);
    else if (v === '-c' || v === '--config') a.config = argv[++i]!;
    else if (v === '-h' || v === '--help') a.cmd = 'help';
    else rest.push(v);
  }
  if (rest[0]) a.cmd = rest[0];
  return a;
}

/**
 * Match an id against a pattern, where `*` matches any run of characters.
 *
 * Globs rather than exact ids because a source collection installs under a
 * shared prefix — excluding a 232-skill collection should be one pattern, not
 * 232 literals.
 */
function matches(id: string, pattern: string): boolean {
  if (!pattern.includes('*')) return id === pattern;
  const re = new RegExp(
    '^' + pattern.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
  );
  return re.test(id);
}

/**
 * Match an artifact against a pattern, optionally scoped to one kind:
 *
 *   vendored-*         any artifact whose id starts with vendored-
 *   skill:vendored-*   only skills
 *
 * The scoped form matters more than it looks. Excluding a skill collection by
 * prefix will otherwise catch unrelated commands and agents that happen to
 * share the prefix — a `vendored-import` command is not a vendored skill.
 */
function matchesArtifact(a: Artifact, pattern: string): boolean {
  const i = pattern.indexOf(':');
  if (i > 0) {
    const kind = pattern.slice(0, i);
    if (KINDS.includes(kind as Kind)) {
      return a.kind === kind && matches(a.id, pattern.slice(i + 1));
    }
  }
  return matches(a.id, pattern);
}

function selectArtifacts(all: Artifact[], wire: Wire): Artifact[] {
  let out = all;
  if (wire.only?.length)
    out = out.filter((a) => wire.only!.some((p) => matchesArtifact(a, p)));
  if (wire.exclude?.length)
    out = out.filter((a) => !wire.exclude!.some((p) => matchesArtifact(a, p)));
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === 'help') {
    console.log(USAGE);
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

  for (const wire of wires) {
    const source = buildSource(wire.source);
    const all = await source.read(wire.kinds ?? KINDS);
    let skills = selectArtifacts(all, wire);
    if (args.kinds.length) skills = skills.filter((s) => args.kinds.includes(s.kind));

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
          sourceRoot: expandPath(wire.source.path),
        });
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

  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(c.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  },
);
