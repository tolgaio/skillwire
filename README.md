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

Node 22+.

The CLI has no runtime dependencies. The terminal UI is built on
[Ink](https://github.com/vadimdemedes/ink) and React, which load only when you
open it.

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

Or do all of it from the terminal UI:

```bash
skillwire -i
```

## Interactive

`skillwire -i` (or `skillwire interactive`) opens a terminal UI over the same
config file. Add sources, see what each one holds, tick what you want, install.

```
╭────────────────────────────────────────────────────────────────────────────╮
│ skillwire › sources › mine                            mine · 500 artifacts │
╰────────────────────────────────────────────────────────────────────────────╯
╭──────────────────────────────────────────╮╭────────────────────────────────╮
│ mine 268 of 500 selected                 ││ pdf-export                     │
│  SKILLS 27/259  2 commands 11/238        ││ kind    skill                  │
│                                          ││ files   4                      │
│ ▸ ● pdf-export        Turn a document…   ││ Turn a document into a tagged, │
│   ● tone-check        Flag hedging an…   ││ accessible PDF, with the       │
│   ▸ vendored/         0/232 selected     ││ heading structure and alt text │
│   1–18 of 259                            ││ a screen reader needs.         │
│  prefix p   exclude skill:vendored-*     ││                                │
╰──────────────────────────────────────────╯╰────────────────────────────────╯
 ✓ saved
 tab kind  space tick  a all  n none  s showing  / search  f filters  ? keys
```

A breadcrumb says where you are, and **`?` shows every key** for the screen you
are on.

The side panel previews whatever the cursor is on: its description in full —
the list has room for a line of it, and a skill's is usually a paragraph saying
when to use it — and then the file itself, with enough markdown rendering to
read it by. `⇧↑` and `⇧↓` scroll it, as does the wheel, and it says where in
the file it is; shift is the modifier that means "the other pane", so plain
arrows keep moving the list. `p` puts the panel away when the list wants the
width, and on a narrow terminal it moves below the list.

### Keys

Arrows and vim keys both work everywhere: `j`/`k` move, `h` goes back, `l` goes
in, `g`/`G` jump to the ends, `^u`/`^d` page. The row under the cursor is a grey
bar across the panel — in a list of five hundred near-identical names, a marker
at the start of the line is not enough to find yourself by. A picked row is a
filled circle, `●`, against a hollow `○` for the rest; `SKILLWIRE_ASCII` falls
back to `[x]`/`[ ]` for a terminal that cannot draw them.

The bar recolours nothing on the row, so a green tick stays a green tick. Grey
is a guess about your terminal, though; set `SKILLWIRE_HIGHLIGHT` to any colour
name or hex if it does not suit yours:

```bash
SKILLWIRE_HIGHLIGHT=blue skillwire -i
```

| where | keys |
|---|---|
| Sources | `a` add · `e` edit · `d` delete · `f` fetch · `r` re-read · `i` install · `D` dry run · `I` install all · `q` quit |
| Browse | `tab`/`1`–`3` switch kind · `space` tick or open a folder · `a` all · `n` none · `v` invert · `s` showing · `p` preview · `⇧↑`/`⇧↓` scroll it · `/` search · `f` filters · `K` kinds · `i` install |
| Filters | `o` add an `only` · `x` add an `exclude` · `k` add an `include` · `d` delete |
| Form | type to edit · `⏎` next field · `←→` change · `space` toggle a target · `^s` save |
| Anywhere | `?` keys · `m` mouse on/off · `q` quit |

### Mouse

Click a skill to tick it, a breadcrumb to go back to it, or a key in the footer
strip to press it. The wheel scrolls the list.

**`m` turns it off.** While the terminal is reporting clicks it stops selecting
text on drag — most terminals still select if you hold shift (option on macOS),
but if you copy out of the list often you will want it off.

### Reviewing a large source

`s` cycles the list between **all**, **selected** and **unselected**. Five
hundred skills is not reviewable by scrolling, and the question you actually
have is "what did I pick?".

`/` searches names and descriptions, and `a`, `n` and `v` act on **what the list
is currently showing** — so `/deploy` then `a` ticks every deploy skill and
nothing else. `esc` clears the search and the showing filter; a second `esc`
leaves the screen.

### Installing

`i` installs the source under the cursor. **It always runs with `--prune`**,
because what is ticked is the whole of what that source should have installed —
an install that only ever added would leave everything you unticked in place and
make the checkboxes a description of nothing. `D` is the same thing as a dry
run, which is the way to see the deletions before they happen. `I` installs
every source.

The same output `skillwire install` prints streams into a panel while it runs,
with a spinner until it finishes. Press enter to go back.

### The config file is the only state

Every change is written straight back — there is nothing to save and no session
to lose — so quitting and running `skillwire install` does exactly what the
screen said. Editing the file by hand and reopening the UI works the same way
round.

### Ticking a box is a filter edit

The checkboxes are a view of [the filters](#filtering), not a second
list living somewhere else. Ticking makes the smallest edit that produces the
result you asked for, so a glob you wrote survives being near a box you clicked:
with `exclude: ["skill:vendored-*"]`, unticking one unrelated skill adds one
entry and leaves the glob alone.

Two consequences worth knowing:

- **Unticking most of a large source is stored as an allowlist.** Picking 3 of
  500 writes `only` with 3 entries, not `exclude` with 497. It flips to
  whichever form is shorter, but only when the source has no globs — a pattern
  you wrote is worth more than a shorter file.
- **Ticking something a pattern excludes writes an `include`.** That list is
  matched after `exclude`, so one artifact is named and the pattern covering
  the rest of its collection is left exactly as it was.

`f` edits the patterns directly, with a live count of what each one matches.

## Filtering

Four filters, applied in this order: **kinds → only → exclude → include**.

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

`only` runs first and is a whitelist; `exclude` then removes from what survives; `include` puts back whatever it names, whatever the other two said. A pattern with no `*` must match the id exactly.

**`only` scoped to one kind leaves the other kinds alone.** `only: ["command:review"]` restricts commands and says nothing about skills or agents. One unscoped pattern speaks for all of them.

**`include` is how you keep one thing out of an excluded collection.** `exclude` has the last word, so without it, keeping a single skill out of a pattern covering two hundred meant giving up the pattern:

```json
"exclude": ["skill:vendored-*"],
"include": ["skill:vendored-pdf"]
```

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
| `-i, --interactive` | open the [terminal UI](#interactive) |
| `--wire <name>` | only this wire. Repeatable |
| `--target <id>` | only this target. Repeatable |
| `--kind <k>` | only this kind. Repeatable |
| `--dry-run` | report what would happen, write nothing |
| `--prune` | remove artifacts this wire installed and no longer produces |
| `--no-fetch` | use the cached clone of a git source without updating it |

Each run reports what changed since the last one — `+ skill:x` for anything new, and a line per artifact pruned — rather than only a count. Both come from the manifest, so they are exact. Lists longer than twenty are summarised.

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

**`the interactive UI needs a terminal`** — `-i` was run with stdin or stdout redirected. It draws to the screen and reads raw keys, so it needs both attached.

**Skills installed but never used by Claude Code** — you're probably over the skill-listing budget; see [claude](#claude--claude-code).

**An artifact vanished** — two wires sharing a target with no `prefix`. Ids collide across sources, so whichever wire runs last overwrites the other. Give at least one wire a prefix.

**Old copies survived a rename** — artifacts installed before skillwire started keeping a manifest have no record, so prune cannot reach them. Remove them once by hand; everything installed since is tracked.

**A git source fails to clone** — skillwire runs `git` and shows what it said. A private repo needs credentials git can find: an SSH URL with your key loaded, or an https URL with a credential helper (`gh auth setup-git`). Try `git clone <the same URL>` by hand — if that fails, skillwire will too.

**A git source found nothing** — the default layout for a repo is `auto`, which looks for directories named `skills`, `commands` and `agents`. If the repo calls them something else, use `dirs`; if they are more than five levels down, point `paths` closer.

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
