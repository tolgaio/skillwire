# skillwire

Push [Agent Skills](https://agentskills.io) — plus commands and agents — from one source of truth into every agent that can use them. **Including ones that aren't filesystems.**

You keep skills in a git repo. skillwire installs them *natively* into each agent, so you get that agent's own support for them: progressive disclosure in Claude Code, `/name` prompts in pi, category grouping in Hermes, workspace skills in Multica.

```bash
npx skillwire install
```

- [Why](#why) · [Supported harnesses](#supported-harnesses) · [Install](#install) · [Quick start](#quick-start)
- [Concepts](#concepts): [wires](#wires) · [kinds](#kinds) · [ids](#ids)
- [Configuration](#configuration) · [Filtering](#filtering) · [CLI](#cli)
- [Targets](#targets) · [Safety](#safety) · [Troubleshooting](#troubleshooting)
- [Contributing](#contributing) — adding a target for your harness

## Why

Because not every agent reads a directory, and the ones that do don't agree on the shape.

Other tools model a target as *a path to copy into*. That covers most harnesses, but not all — Multica stores skills in a database, so it cannot be expressed that way at all. A skillwire target is therefore a **behaviour**, not a path:

```ts
interface Target {
  install(artifacts: Artifact[], opts: InstallOptions): Promise<InstallResult>;
}
```

Anything that can accept a skill can be a target: an API, a database, a container, a remote host.

## Supported harnesses

| target | kinds | destination | status |
|---|---|---|---|
| `claude` | skill, command, agent | `~/.claude/{skills,commands,agents}/` | **used in anger** |
| `multica` | skill, agent | PostgreSQL, via its CLI | **used in anger** |
| `pi` | skill, command | `~/.pi/agent/{skills,prompts}/` | implemented, not yet exercised |
| `hermes` | skill | `~/.hermes/skills/<category>/` | implemented, not yet exercised |

"Implemented, not yet exercised" means the code runs and reports correctly under
`--dry-run`, but has never written a file in earnest. Treat those two as
unproven and use `--dry-run` first.

### Not yet implemented

Plenty of harnesses read the same `SKILL.md` convention and would each be a
small adapter. None of these exist yet:

Cursor · Codex · opencode · Gemini CLI · GitHub Copilot · Windsurf · Zed ·
Kiro · Qwen · Amp · Goose · Roo · Trae · Droid · Kimi · OpenClaw ·
Antigravity · CodeBuddy

Most are a directory and a naming convention — see [adding a target](#adding-a-target).
If you use one of these, a pull request adding it is very welcome; you do not
need to be able to test the others.

## Install

```bash
npm i -g skillwire     # or run it with: npx skillwire
```

Node 20+. No runtime dependencies.

## Quick start

```bash
cd ~/src/my-skills
cat > skillwire.config.json <<'EOF'
{
  "wires": [
    { "name": "mine", "source": { "path": "." }, "targets": ["claude"] }
  ]
}
EOF

skillwire list              # what it found
skillwire targets           # which agents are installed here
skillwire install --dry-run # what it would do
skillwire install           # do it
```

## Concepts

### Wires

Both wires above install into `claude`, which is why the second carries a
`prefix` — see [namespacing](#namespacing-a-source).

A **wire** connects one source to many targets. That's the unit of work, and the tool's name.

```json
{ "name": "personal", "source": { "path": "~/src/my-skills" }, "targets": ["claude", "pi"] }
```

Several wires can feed the same target — personal and work skills both landing in Claude Code — while diverging elsewhere. Wires are independent: one failing doesn't stop the rest.

### Kinds

skillwire carries three kinds of thing, which differ in shape *and* in which targets accept them:

| kind | on disk | source dir | claude | pi | hermes | multica |
|---|---|---|---|---|---|---|
| `skill` | directory + `SKILL.md` | `skills/` | ✓ | ✓ | ✓ | ✓ |
| `command` | single `.md` | `commands/` | ✓ | ✓ as prompts | — | — |
| `agent` | single `.md` | `agents/` | ✓ | — | — | ✓ |

Kinds a target can't accept are **reported, not silently dropped**:

```
would  hermes  27 installed
       ! 238 commands: Hermes Agent takes no commands
```

### Ids

An artifact's **id** is its path within its kind directory, dash-joined:

```
skills/pdf-export/               ->  pdf-export
skills/writing/tone-check/       ->  writing-tone-check
skills/vendored/rewrite/default/ ->  vendored-rewrite-default
commands/review.md               ->  review
```

Targets install into one flat directory, so a hierarchy has to flatten. Using the basename alone would collide — one real repo has four different skills called `default` — and silently overwrite. The full path is unique by construction and says where the thing came from.

The id is what you filter on, and what a skill is called once installed. The
installed copy's frontmatter `name` is rewritten to match it, so a file never
contradicts the directory it sits in — your source files are not modified.

## Configuration

`skillwire.config.json` in the working directory, or `~/.config/skillwire/skillwire.config.json`. Override with `-c`.

```json
{
  "wires": [
    {
      "name": "personal",
      "source": { "path": "~/src/my-skills", "layout": "flat" },
      "kinds": ["skill", "command"],
      "exclude": ["skill:vendored-*"],
      "targets": ["claude", "pi"]
    },
    {
      "name": "work",
      "prefix": "work",
      "source": { "path": "~/src/team-skills/plugins", "layout": "nested" },
      "targets": [
        "claude",
        { "id": "hermes", "defaultCategory": "work" },
        { "id": "multica", "workspace": "work", "agentRuntime": "Claude (myhost)" }
      ]
    }
  ]
}
```

### Wire fields

| field | type | meaning |
|---|---|---|
| `name` | string | label, and what `--wire` matches |
| `source` | object | where artifacts come from |
| `targets` | array | strings, or `{ "id": ..., ...options }` |
| `kinds` | array | which kinds to wire. Default: all three |
| `only` | array | install only ids matching these patterns |
| `exclude` | array | never install ids matching these patterns |
| `prefix` | string | namespace this wire's ids as `<prefix>-<id>` |

### Source

| field | default | meaning |
|---|---|---|
| `path` | — | **repo root**, not the skills directory |
| `layout` | `flat` | `flat` or `nested` |
| `dirs` | see below | override the subdirectory for a kind |

`path` points at the repo, and each kind is read from a subdirectory of it — `skills/`, `commands/`, `agents/`. A repo missing one of those simply contributes nothing for that kind.

**`flat`** — kinds directly under the root. Most skill repos:

```
my-repo/skills/pdf-export/SKILL.md
my-repo/commands/review.md
```

**`nested`** — one grouping level first, the Claude Code plugin-marketplace layout:

```
my-repo/plugins/tools/skills/style-guide/SKILL.md
                └── group ──┘
```

The group travels with each artifact, so targets that organise by category (Hermes) use it and targets that don't ignore it. Point `path` at `plugins/`.

Skills nested deeper are still found, at any depth — see [ids](#ids).

**`dirs`** renames a kind's subdirectory:

```json
"source": { "path": "~/src/my-skills", "dirs": { "command": "prompts" } }
```

### Namespacing a source

Ids are unique *within* a source but not across sources. Two repos can each hold
a `pdf-export` skill, and without a prefix the second wire installed silently
overwrites the first.

```json
{ "name": "work", "prefix": "work", "source": { "path": "~/src/team-skills/plugins" }, "targets": ["claude"] }
```

Every id from that wire becomes `work-<id>` — `work-pdf-export` alongside your own
`pdf-export`.

The prefix is applied **after** `only` and `exclude`, so patterns match ids as
they appear in the repo rather than the prefixed form.

Adding or changing a prefix renames every artifact the wire installs. The
artifacts under the old names are not left stranded: skillwire records what each
wire installed, so the next `--prune` removes them. See
[Prune is bounded](#prune-is-bounded).

> **If two wires share a target, give at least one of them a prefix.** Without
> one, overlapping ids overwrite each other on every run.

## Filtering

Three independent filters, applied in this order: **kinds → only → exclude**.

### By kind

Config, per wire:

```json
"kinds": ["skill"]
```

Or per invocation, repeatable:

```bash
skillwire install --kind skill --kind agent
```

### By id pattern

`only` and `exclude` match **ids**, with `*` as a wildcard for any run of characters.

```json
"only":    ["deploy-*", "pdf-export"],
"exclude": ["*-draft", "experimental-*"]
```

`only` runs first and is a whitelist; `exclude` then removes from what survives. A pattern with no `*` must match the id exactly.

### Scoping a pattern to one kind

Prefix a pattern with `<kind>:` to restrict it:

```json
"exclude": ["skill:vendored-*"]
```

**This matters more than it looks.** A bare `vendored-*` would also match a `vendored-import` *command* or a `vendored-sync` *agent* — things that share the prefix but aren't part of the collection you meant. Scoping excludes only the skills.

Unscoped patterns apply to every kind.

### Worked example

A repo whose `skills/` holds a couple of dozen skills of your own plus a large vendored collection under `vendored/`, and you want the collection kept out of Claude Code because it would crowd out everything else:

```json
{
  "name": "personal",
  "source": { "path": "~/src/my-skills" },
  "exclude": ["skill:vendored-*"],
  "targets": ["claude"]
}
```

```bash
skillwire list --kind skill      # confirm the set you expect
skillwire install --dry-run      # confirm before writing
skillwire install --prune        # install, and remove any already installed
```

## CLI

```
skillwire install [flags]     install artifacts into targets
skillwire list [flags]        show what each wire would install, grouped by kind
skillwire targets             show which targets are present on this machine
```

| flag | meaning |
|---|---|
| `-c, --config <path>` | config file to use |
| `--wire <name>` | only this wire. Repeatable |
| `--target <id>` | only this target. Repeatable |
| `--kind <k>` | only this kind. Repeatable |
| `--dry-run` | report what would happen, write nothing |
| `--prune` | also remove artifacts at the target that are absent from the source |

**Always `--dry-run` before `--prune`.** Prune deletes, and a mistaken filter is much cheaper to notice in a report than after the fact.

Exit code is 0 unless a target failed.

## Targets

### `claude` — Claude Code

Takes all three kinds, into `~/.claude/skills`, `~/.claude/commands` and `~/.claude/agents`.

Worth knowing: Claude Code loads every skill's name and description into context to decide what's relevant, within a budget of about 1% of the model's context window. Past roughly 150–200 skills it starts **dropping descriptions** while keeping names, which strips the keywords it matches on. Symptom: skills that exist but never get chosen. Run `/doctor` to check, raise `skillListingBudgetFraction`, or wire fewer skills.

### `pi`

Skills to `~/.pi/agent/skills`, commands to `~/.pi/agent/prompts` — pi's prompt templates, invoked as `/name`, are the closest equivalent to a command.

No agents: pi has no subagent-definition concept, so wiring them would write files it ignores.

### `hermes` — Hermes Agent

Skills only, one level deeper than everything else:

```
~/.hermes/skills/<category>/<skill>/SKILL.md
~/.hermes/skills/<category>/DESCRIPTION.md
```

| option | default | meaning |
|---|---|---|
| `skillsDir` | `~/.hermes/skills` | where Hermes keeps skills |
| `defaultCategory` | `custom` | category for artifacts with no source group |

The category comes from the source group when there is one — a `nested` layout gives you that for free — otherwise `defaultCategory`.

skillwire only touches categories it installs into, so Hermes's own bundled skills are untouched, and it writes `DESCRIPTION.md` only when absent so a hand-written one is never clobbered.

Hermes in a container is fine: with `-v ~/.hermes:/opt/data` and `HERMES_HOME=/opt/data`, the host path is the right thing to write to.

### `multica`

Skills and agents, into a Multica workspace over its API.

| option | default | meaning |
|---|---|---|
| `bin` | `multica` | path to the CLI |
| `workspace` | current | workspace to install into |
| `onConflict` | `overwrite` | `fail`, `overwrite`, `rename`, `skip` |
| `agentRuntime` | — | runtime name for created agents, e.g. `Claude (myhost)` |

**Skills** are packaged as a zip and uploaded with `skill import --file`, not `--url`. The URL form records an origin and enables `skill refresh`, but that import runs **server-side** — the backend fetches the URL itself, so it only works for repos the backend can read. Uploading bytes needs no credentials, which is what makes private skill repos work. The trade-off: a `--file` import records no origin, so `skill refresh` can't re-pull it. Re-running skillwire is the refresh.

Multica keys skills on the `name` in their frontmatter rather than on where they came from. skillwire rewrites that field to the id for every target, but here it is load-bearing rather than cosmetic: without it, two skills declaring the same name overwrite each other however distinct their paths were, and nested skills lose their prefix entirely.

**Agents** map to `agent create` / `agent update`, since Multica has no file import for them. Only `name`, `description` and `instructions` are sent — runtime, model, MCP config and skill assignments are set in the UI and aren't expressible in an agent file, so writing them would silently revert choices you made elsewhere. `--runtime-id` is mandatory on create and is a workspace-specific UUID, so it comes from `agentRuntime` as a runtime *name*; without it, agents are skipped rather than guessed at. Claude's `tools:` frontmatter has no equivalent and is dropped.

**The CLI is scoped to one workspace.** Setting `workspace` switches it first — but that changes the profile default, which a local daemon also reads, so a dry run reports the switch rather than performing it.

## Safety

### It refuses to install into its own source

The usual way to expose skills to Claude Code is to symlink `~/.claude/skills` at the repo holding them — which makes the target resolve *back to the source*. Installing replaces each artifact, so that would rewrite your repo in place; and pointing a second source at the same target would overwrite one repo's content with another's.

```
fail  claude  refusing to install: Claude Code skills resolves to
      /home/you/src/my-skills/skills, which is inside the source ...
```

Both paths are resolved through symlinks before comparing, because the whole problem is that the target *is* a link. If you currently symlink, remove the link and let skillwire own the directory.

### Prune is bounded

`--prune` removes only what skillwire itself installed and is no longer installing. It does not remove everything at the target that is absent from the source.

Each run records the artifacts each wire installed at each target, in `~/.local/state/skillwire/manifest.json` (or `$XDG_STATE_HOME/skillwire/`). Prune deletes exactly the difference between that record and the current run. So:

- artifacts from **another wire**, or installed **by hand**, or shipped by the harness itself, are never touched — they were never recorded
- artifacts whose **ids changed** — because a prefix was added, or the source layout moved — are still removed, even though nothing about their new names would identify them
- with **no record** (first run, or a deleted manifest) prune does nothing, rather than guessing from the directory listing

Delete the manifest and skillwire forgets what it owns; it will reinstall, but it can no longer clean up what it left behind.

For **Multica** it only deletes skills **you** created, checked against `skill.created_by`. A workspace is shared, so "not in my source" doesn't mean "unwanted" — a colleague's skill, or one authored in the web UI, survives and is reported instead. Agents are never pruned: Multica archives rather than deletes them, which is better done deliberately.

Deleting a Multica skill also drops its agent assignments. There's no way to remove one without the other, which is why prune is opt-in.

## Troubleshooting

**`no config found`** — skillwire looked for `skillwire.config.json` and `.skillwire.json` in the working directory and `~/.config/skillwire/`. Pass `-c`.

**A target says `not present on this machine`** — `detect()` found no config directory for it. `skillwire targets` shows what was detected.

**Fewer artifacts than expected** — check `skillwire list` first. A directory under `skills/` with no `SKILL.md` isn't a skill; skillwire looks one level deeper, and if that yields nothing the directory is ignored. Filters apply in the order kinds → only → exclude.

**A filter caught more than intended** — an unscoped pattern applies to every kind. Use `skill:pattern` to restrict it.

**Skills installed but never used by Claude Code** — you're probably over the skill-listing budget; see [claude](#claude--claude-code).

**An artifact vanished** — two wires sharing a target with no `prefix`. Ids collide across sources, so whichever wire runs last overwrites the other. Give at least one wire a prefix.

**Old copies survived a rename** — artifacts installed before skillwire started keeping a manifest have no record, so prune cannot reach them. Remove them once by hand; everything installed since is tracked.

**Multica: `runtime "X" not found`** — `agentRuntime` must match a name from `multica runtime list` exactly, and runtimes are workspace-specific.

## Contributing

The most useful contribution is **a target for a harness you actually use.**
skillwire supports four; there are a couple of dozen more, and each is largely a
directory and a naming convention. You don't need to own the other harnesses to
add one — CI covers Linux and macOS on Node 20, 22 and 24, and the test suite
uses fixtures rather than real installations.

Bug reports about the two unexercised targets (`pi`, `hermes`) are especially
welcome, since nobody has yet run them for real.

### Adding a target

A target implements one interface:

```ts
export class MyTarget implements Target {
  readonly id = 'mine';
  readonly name = 'My Harness';
  readonly kinds: Kind[] = ['skill', 'command'];

  async detect(): Promise<boolean> {
    // Is this harness present on this machine? Usually: does its config
    // directory exist? Returning false makes skillwire skip it with a note
    // rather than fail.
    return existsSync(join(homedir(), '.myharness'));
  }

  async install(artifacts: Artifact[], opts: InstallOptions): Promise<InstallResult> {
    const { accepted, result } = partitionByKind(artifacts, this.kinds, this.name);
    for (const a of accepted) {
      if (!opts.dryRun) { /* however your harness takes it */ }
      result.installed.push(a.id);
    }
    return result;
  }
}
```

Then register it in `src/config.ts`'s `buildTarget`.

If your harness stores skills as flat directories of files — most do —
`FilesystemTarget` already does the work, and the whole target is a couple of
lines:

```ts
export const myHarness = () =>
  new FilesystemTarget('mine', 'My Harness', {
    skill: '~/.myharness/skills',
    command: '~/.myharness/prompts',
  });
```

Four things to get right, in rough order of how much damage getting them wrong does:

1. **Honour `opts.dryRun`.** It is the flag people reach for before doing
   something destructive, and it must write nothing at all.
2. **Call `assertNotInsideSource()` before writing.** Symlinking a harness's
   skills directory at the source repo is a common setup, and without this check
   installing rewrites the user's repository in place.
3. **Use `partitionByKind()`** so kinds your harness cannot take are reported
   rather than silently dropped.
4. **Prune only what is in `opts.previouslyInstalled`** if you implement
   pruning. It lists what this wire put here last time, as `kind:id`. Anything
   else at the destination belongs to someone else. When it is empty, prune
   nothing.

`writeArtifact()` handles the directory-versus-file distinction between kinds,
so prefer it over writing files yourself.

### Adding something other than a filesystem

`install()` is deliberately a behaviour rather than a path, so a target can be
an API, a database, a message queue, a remote host. `src/targets/multica.ts` is
the worked example: it packages each artifact as a zip and uploads it through a
CLI, maps a second kind onto a completely different API call, and bounds its
prune to objects the current user created because the destination is shared.

If your destination has no concept of one of the kinds, leave it out of `kinds`
rather than inventing a mapping — `pi` takes no agents for exactly this reason.

### Running the tests

```bash
npm install
npm test          # builds, then runs the suite
npm run typecheck
```

Tests live beside the code as `*.test.ts` and use Node's built-in runner with
fixtures in a temp directory — no network, no real harnesses, no fixtures
checked into the repo.

If you are changing anything that installs or deletes, add a test for it. The
suite is weighted that way on purpose: the risky paths are prune, the
containment guard, and id derivation, because a mistake in any of them is
silent and destructive.

### What counts as a breaking change

See [RELEASES.md](RELEASES.md). Note that **changing how ids are derived is
breaking** even though it is not an API change: ids are what gets installed, so
changing the scheme orphans everything already installed, which the next
`--prune` then deletes.

## Releases

Version history, what each release was verified against, and current known
limitations: [RELEASES.md](RELEASES.md).

skillwire is `0.x` — breaking changes can land in a minor bump, and are called
out there.

## License

MIT
