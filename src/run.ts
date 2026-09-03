import { KINDS, type Artifact, type Kind } from './artifact.js';
import { buildSource, buildTarget, type Config, type Wire } from './config.js';
import { selectArtifacts } from './filter.js';
import { previouslyInstalled, readManifest, record, writeManifest } from './manifest.js';
import { c } from './style.js';

/**
 * How many per-artifact lines to print before summarising the rest.
 *
 * A first install names everything it added, which for a large source is a
 * screenful; past this the count says more than the list does.
 */
const LIST_CAP = 20;

export interface RunOptions {
  wires?: string[];
  targets?: string[];
  kinds?: Kind[];
  dryRun?: boolean;
  prune?: boolean;
  noFetch?: boolean;
  /** Report what each wire would install instead of installing it. */
  listOnly?: boolean;
}

/**
 * Install (or list) every selected wire.
 *
 * Lives apart from the CLI so the interactive picker runs the same code rather
 * than a second implementation of it — the one thing worse than a TUI that
 * cannot install is a TUI that installs slightly differently.
 */
export async function run(
  config: Config,
  opts: RunOptions,
  log: (line: string) => void,
): Promise<number> {
  const wires = opts.wires?.length
    ? config.wires.filter((w) => opts.wires!.includes(w.name))
    : config.wires;

  let failed = false;
  let manifest = await readManifest();

  for (const wire of wires) {
    const source = buildSource(wire.source);
    let sourceRoot: string;
    try {
      sourceRoot = await source.prepare({
        fetch: !opts.noFetch,
        onProgress: (m) => log(`\n${c.bold(wire.name)}  ${c.dim(m)}`),
      });
    } catch (err) {
      failed = true;
      log(`\n${c.bold(wire.name)}  ${c.red('fail')}  ${message(err)}`);
      continue;
    }

    const all = await source.read(wire.kinds ?? KINDS);
    let skills = selectArtifacts(all, wire);
    if (opts.kinds?.length) skills = skills.filter((s) => opts.kinds!.includes(s.kind));
    // After filtering, so patterns match ids as they appear in the repo.
    if (wire.prefix) {
      const pre = wire.prefix.replace(/-+$/, '');
      skills = skills.map((s) => ({ ...s, id: `${pre}-${s.id}` }));
    }

    log(
      `\n${c.bold(wire.name)}  ${c.dim(source.name)}  ${skills.length} item${skills.length === 1 ? '' : 's'}` +
        (skills.length !== all.length ? c.dim(` (of ${all.length})`) : ''),
    );

    if (opts.listOnly) {
      listWire(skills, log);
      continue;
    }

    for (const tc of wire.targets) {
      const target = buildTarget(tc);
      if (opts.targets?.length && !opts.targets.includes(target.id)) continue;

      if (!(await target.detect())) {
        log(`  ${c.dim('skip')}    ${target.id}  ${c.dim('not present on this machine')}`);
        continue;
      }

      const before = previouslyInstalled(manifest, wire.name, target.id);
      const owned = skills
        .filter((a) => target.kinds.includes(a.kind))
        .map((a) => `${a.kind}:${a.id}`);

      try {
        const res = await target.install(skills, {
          dryRun: opts.dryRun,
          prune: opts.prune,
          previouslyInstalled: before,
          sourceRoot,
        });
        // Record what this wire now owns at this target, so a later run can
        // prune artifacts it stops producing — including ones whose ids changed
        // because a prefix was added or the layout moved.
        if (!opts.dryRun) manifest = record(manifest, wire.name, target.id, owned);

        // What is new, from the same record prune reads. Every run reinstalls
        // everything, so the count alone cannot answer the only question worth
        // asking after ticking a box: did that one arrive?
        const seen = new Set(before);
        const added = owned.filter((id) => !seen.has(id));

        const verb = opts.dryRun ? c.yellow('would') : c.green('ok   ');
        const delta = added.length ? c.dim(`  ${added.length} new`) : '';
        log(`  ${verb}    ${target.id}  ${res.installed.length} installed${delta}`);
        capped(added.map((id) => `${c.green('+')} ${id}`), log);
        capped(
          res.skipped.map((s) => `${c.yellow('!')} ${s.id}: ${s.reason}`),
          log,
        );
      } catch (err) {
        failed = true;
        log(`  ${c.red('fail')}    ${target.id}  ${message(err)}`);
      }
    }
  }

  if (!opts.dryRun && !opts.listOnly) await writeManifest(manifest);
  return failed ? 1 : 0;
}

function capped(lines: string[], log: (line: string) => void): void {
  for (const line of lines.slice(0, LIST_CAP)) log(`          ${line}`);
  if (lines.length > LIST_CAP)
    log(`          ${c.dim(`… and ${lines.length - LIST_CAP} more`)}`);
}

function listWire(skills: Artifact[], log: (line: string) => void): void {
  for (const kind of KINDS) {
    const of = skills.filter((s) => s.kind === kind);
    if (!of.length) continue;
    log(`  ${c.dim(kind + 's')}`);
    for (const s of of) {
      const group = s.group ? c.dim(`${s.group}/`) : '';
      log(
        `    ${group}${s.id}  ${c.dim(`${s.files.length} file${s.files.length === 1 ? '' : 's'}`)}`,
      );
    }
  }
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Read one wire's source, for the interactive picker's list. */
export async function readWire(
  wire: Wire,
  opts: { fetch?: boolean; onProgress?: (m: string) => void } = {},
): Promise<{ artifacts: Artifact[]; sourceName: string }> {
  const source = buildSource(wire.source);
  await source.prepare(opts);
  return { artifacts: await source.read(wire.kinds ?? KINDS), sourceName: source.name };
}
