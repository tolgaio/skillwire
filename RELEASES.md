# Releases

## Versioning

skillwire follows [semantic versioning](https://semver.org). While on `0.x` the
API is not stable: **breaking changes may land in a minor bump**, and are always
called out under a `Breaking` heading.

Three things count as breaking, all of them user-visible:

- a change to the **config schema** — a renamed or removed field, or a changed default
- a change to how **ids are derived**, since ids are what gets installed and what
  `only`/`exclude` match. Changing the scheme orphans previously installed
  artifacts, which `--prune` then removes
- a change to where a **target writes**

---

## Unreleased

### Added

- **A terminal UI**, `skillwire -i`. Add, edit, delete and fetch sources; browse
  what each one holds with names and descriptions; tick the artifacts you want.

  The config file is the only state — every change is written straight back, so
  quitting the UI and running `skillwire install` does exactly what the screen
  said, and a file edited by hand reads back the same way.

  Ticking a box is an edit to `only`/`exclude`, made as small as possible: a
  glob you wrote survives being near a box you clicked. Where the filter
  language cannot express a change — a single artifact inside an excluded glob,
  since `exclude` has the last word — the UI says which pattern is responsible
  instead of rewriting it into something that means something else.

  `i` installs, always with `--prune`: what is ticked is the whole of what that
  source should have installed, and an install that only ever added would make
  the checkboxes a description of nothing. `D` previews it.

  `s` cycles the list between all, selected and unselected, because five hundred
  skills is not reviewable by scrolling. `/` searches, and the bulk keys act on
  what the list is showing rather than the whole source.

  Arrows and vim keys both work, `?` shows every binding for the screen you are
  on, a breadcrumb says where you are, and a panel under the list carries the
  full description of the row under the cursor.

  Built on [Ink](https://github.com/vadimdemedes/ink) and React. Flexbox is
  what buys the side panel and a layout that survives any terminal size without
  a single row calculation, and Ink's own test renderer means the picker is
  driven through the real component tree in the suite — `stdin.write` for keys,
  `lastFrame()` for what a terminal would show.

  The CLI keeps no runtime dependencies of its own: the UI is a dynamic import,
  so `skillwire install` never loads it.

  The row under the cursor is a grey bar across the panel, in every list — a
  marker at the start of the line is not enough to find yourself by in a list of
  five hundred near-identical names. It recolours nothing on the row, so a green
  tick stays a green tick; `SKILLWIRE_HIGHLIGHT` picks a different colour for a
  terminal grey does not suit.

  **The mouse works**: click a skill to tick it, a breadcrumb to go back to it,
  a key in the footer to press it, and the wheel to scroll. Ink has no mouse
  API, so the terminal is asked to report clicks and the reports are parsed out
  of the input stream before any screen can read them as keystrokes. Regions
  are measured from Ink's own layout rather than calculated, so they stay right
  when the terminal resizes or a panel appears. `m` turns tracking off, because
  while it is on the terminal stops selecting text on drag.

- **Git sources.** A wire can read from a repository instead of a local
  directory:

  ```json
  "source": { "git": "owner/name", "ref": "v2" }
  ```

  `owner/name` means GitHub; anything else is passed to git as written, so any
  host works. Authentication is git's own — an SSH key or a credential helper —
  and skillwire never takes, stores or logs a token. Clones are shallow, cached
  under `~/.cache/skillwire/repos/`, and reset on every fetch so a force-push
  cannot strand a stale artifact. `--no-fetch` reads the cache without the
  network.

  A cloned repo is then read exactly as a directory is, so ids, filtering,
  prefixes and prune are unchanged.

- **`layout: "auto"`**, which finds the kind directories wherever they are —
  at the root, under `.claude/`, one per plugin, or all three at once. It is the
  default for a git source, since a repo you point at is not necessarily one you
  laid out. It stops at a kind directory and never walks into a skill, so a
  skill shipping its own `commands/` does not contribute commands to the repo.

- **`paths`**, scanning only part of a source. Ids stay relative to the source
  root rather than to the scan path, so adding an entry never renames anything
  else, and two paths that each hold a `deploy` skill produce two distinct ids
  instead of one overwriting the other. A path that climbs out of the source is
  refused.

- Test suite covering the ZIP writer, frontmatter parsing, source discovery and
  id derivation, filter matching, the manifest, and the filesystem target
  including its prune and containment behaviour.
- CI on Linux and macOS, Node 20/22/24.

### Breaking

- **Node 22 is now the minimum**, up from 20, which reached end of life in
  April. It is what Ink requires, and nothing is published yet for the bump to
  break.

### Fixed

- **YAML block scalars in frontmatter were dropped.** A skill written as
  `description: |` or `description: >` — which many are — parsed to the
  indicator character and lost the text. Descriptions are now read properly,
  with folded style joining the lines the author wrapped.

- **`--prune` could not remove artifacts whose ids had changed.** Prune was
  scoped to a wire's prefix, so anything installed under a *previous* naming
  fell outside the scope and became unreachable: adding a prefix to an existing
  wire installed a second, complete copy of everything and left the first behind
  with no way to clean it up. Changing the source layout had the same effect.

  skillwire now records what each wire installed at each target, and prunes the
  difference between that record and the current run. A rename is just "these
  ids are no longer produced", so the old set is removed.

  Artifacts installed before this release have no record and so cannot be
  pruned; remove them once by hand.

### Changed

- **Prune is bounded by what skillwire installed, not by what is absent from the
  source.** Artifacts belonging to another wire, installed by hand, or shipped
  by the harness are never removed, and prune with no record does nothing.
  Previously the prefix was the only thing standing between one wire's prune and
  another wire's work; a wire without a prefix pruned everything it did not
  recognise.

- **`install` names what it added**, the way prune already named what it
  removed. Every run reinstalls everything, so the count alone could not answer
  the only question worth asking after ticking a box — did that one arrive? The
  additions come from the same manifest prune reads, so they are exact rather
  than inferred. Long lists are capped at twenty with a count for the rest.

- **Colour is switched off when output is not a terminal**, and honours
  `NO_COLOR`. `skillwire list | grep` no longer matches against escape
  sequences.

- **A source directory that does not exist is now an error** rather than an
  empty read. A typo was previously indistinguishable from a repo with nothing
  in it — and with `--prune`, the difference is everything the wire installed.

- State is written to `~/.local/state/skillwire/manifest.json`, honouring
  `XDG_STATE_HOME`. This is the first file skillwire keeps outside its targets.
  Deleting it is safe — skillwire reinstalls, but forgets what it may clean up.

- **An installed artifact now declares its id as its frontmatter `name`.**
  Previously only Multica did this, because it keys on that field; filesystem
  targets copied files verbatim, so a skill installed as `work-pdf-export` still
  declared `name: pdf-export`. The id is the artifact's identity — it is what gets
  installed, what filters match, and what a target calls it — and a file
  claiming otherwise contradicts the directory it sits in. Any harness that
  preferred the declared name over the location would have reintroduced exactly
  the collisions flattening exists to prevent.

  Source files are never modified; only the installed copy. Supporting files are
  still copied byte for byte.

- Filter matching moved out of the CLI into `src/filter.ts` so it can be tested
  directly. No behaviour change.

---

## 0.0.1 — 2026-08-29

First tagged release.

### Added

Push skills, commands and agents from one or more source repositories into every
agent that can use them, natively — so each agent's own support applies rather
than a lowest common denominator.

**Targets**

| target | kinds | destination |
|---|---|---|
| `claude` | skill, command, agent | `~/.claude/{skills,commands,agents}/` |
| `pi` | skill, command | `~/.pi/agent/{skills,prompts}/` |
| `hermes` | skill | `~/.hermes/skills/<category>/` |
| `multica` | skill, agent | PostgreSQL, via its CLI |

Multica is why a target is `install(artifacts)` rather than a directory path: it
stores skills in a database, so it cannot be expressed as a place to copy files
to.

**Sources** — `flat` (`<root>/skills/<skill>/`) and `nested`
(`<root>/<group>/skills/<skill>/`, the Claude Code plugin-marketplace layout),
with skills discovered at any depth below either.

**Ids** — an artifact's path within its kind directory, dash-joined
(`skills/writing/tone-check/` → `writing-tone-check`). Targets install into one
flat namespace, so hierarchies flatten; basenames alone would collide.

**Filtering** — by kind, and by `only`/`exclude` glob patterns, optionally
scoped to a single kind (`skill:vendored-*`).

**Namespacing** — an optional per-wire `prefix`, for when two sources hold an
artifact with the same id.

**Safety** — refuses to install into its own source, resolving symlinks first,
since symlinking `~/.claude/skills` at the source repo is a common setup and
would otherwise rewrite the repo in place. `--dry-run` on every command.
`--prune` is opt-in, scoped to a wire's prefix, and on Multica bounded to skills
the authenticated user created.

**CLI** — `install`, `list`, `targets`; `--dry-run`, `--prune`, `--wire`,
`--target`, `--kind`, `--config`, `--version`.

### Maturity

Early. The `claude` and `multica` targets have been used against real systems;
`pi` and `hermes` have not yet been exercised beyond a dry run, and Multica
agent creation is implemented but unproven. Hermes carries the most placement
logic of any target, so it is the likeliest to need fixing.

There is no test suite yet. For a tool whose primary verbs are "overwrite" and
"delete", treat `--dry-run` as mandatory before `--prune`.

### Known limitations

- **No test suite, and no CI.**
- **The ZIP writer is hand-rolled** — deliberately dependency-free, since the
  tool runs on servers where `zip` is often absent. It omits zip64 and directory
  entries, which skill archives do not need.
- **Claude Code nested-skill support is assumed, not confirmed.** Flattening is
  required by Multica regardless, but whether Claude Code needs it is unverified.
- **`--prune` does not confirm.** The guard is `--dry-run`.
- **Multica `--file` imports record no origin**, so `skill refresh` cannot
  re-pull them; re-running skillwire is the refresh. This is a deliberate trade:
  `--url` imports run server-side and so cannot read private repositories.
- **Setting a Multica `workspace` changes the CLI profile default**, which a
  local daemon also reads. A dry run reports the switch rather than performing it.
- **Wires sharing a target need a `prefix`**, or ids collide and each wire's
  `--prune` removes the other's artifacts. Documented, not enforced.

### Note on scale

Claude Code loads every skill's name and description into context to decide
relevance, within a budget of roughly 1% of the model's context window. Past a
few hundred skills it starts dropping descriptions while keeping names, so
skills remain installed but stop being matched. A property of Claude Code rather
than of skillwire, but it shapes how many skills are worth wiring there.
