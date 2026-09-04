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

## Publishing

RELEASES.md is wrapped to eighty columns, which is right for a file read in an
editor and wrong for a GitHub release body: those render with GFM's
soft-break-as-hard-break rule, so every wrap becomes a line break and the notes
stop dead at eighty characters however wide the page is.

```bash
npm run release-notes 0.0.2 > notes.md && gh release create v0.0.2 -F notes.md
```

That pulls the section out and unwraps the paragraphs, leaving headings, lists,
tables and fenced code alone.

## Unreleased

### Breaking

- **An `only` list scoped to one kind now leaves the other kinds alone.**
  `only` is a whitelist, so anything it did not name was dropped — including
  whole kinds it never mentioned, which made `only: ["command:review"]` mean
  "one command, and no skills or agents at all". Naming a kind is a statement
  about that kind. One unscoped pattern still speaks for all of them.

### Added

- **The preview panel shows the file, not only the description**, with enough
  markdown rendering to read a SKILL.md by: headings, lists and fenced code.
  Only the primary file — a skill can carry a dozen, and a panel that tried to
  be a file browser would stop being a glance. `p` puts it away when the list
  wants the width.

- **An open folder indents what is inside it** and drops its own name from each
  row, which the row above already carries.

- **The kind tabs carry the colour and the filters do not.** The open tab is
  filled with its own colour, the rest are dim, which is the whole of what
  makes a row of words read as tabs. What the filters are moved to a grey strip
  along the bottom of the panel: worth a glance, not the first thing read.

- **A filled circle marks a picked row**, against a hollow one for the rest.
  Scanning three hundred rows for what is on is a job for contrast, and fill is
  caught at a glance where `[x]` against `[ ]` has to be read. Not emoji: those
  are two cells wide, terminals disagree about whether they really are, and a
  marker whose width is a matter of opinion pulls every column after it out of
  line. `SKILLWIRE_ASCII` falls back to brackets.

- **Skills, commands and agents are tabs in the interactive picker**, each
  counted, one listed at a time. They are three different things that happen to
  share a repo, and interleaved, "how many commands does this hold" meant
  scrolling and counting. `tab` cycles, `1`–`3` jump, and a tab can be clicked.
  A source holding one kind shows no tab bar.

- **Collections are folders in the picker**, one collapsible row each, with how
  much of the folder is selected. A source that keeps two hundred skills in one
  directory was two hundred rows to scroll past. `space`, `⏎`, `←` and `→` open
  and close them, and a search opens them all, since a match may be inside one.

---

## 0.0.2 — 2026-09-03

### Added

**A terminal UI** — `skillwire -i`. Add, edit, delete and fetch sources, browse
what each one holds with names and descriptions, tick what you want, install.
Keyboard or mouse. Built on [Ink](https://github.com/vadimdemedes/ink); the CLI
keeps no runtime dependencies of its own, since the UI loads only when opened.

The config file stays the only state. Every change is written straight back, so
quitting the UI and running `skillwire install` does exactly what the screen
said, and a file edited by hand reads back the same way. Ticking a box is an
edit to `only`/`exclude`, made as small as possible, so a glob you wrote
survives being near a box you clicked.

**Git sources** — a wire can read from a repository rather than a local
directory:

```json
"source": { "git": "owner/name", "ref": "v2" }
```

`owner/name` means GitHub; anything else is passed to git as written. Auth is
git's own — an SSH key or a credential helper — and skillwire never handles a
token. Clones are shallow and cached; `--no-fetch` works offline.

**`layout: "auto"`** finds skill, command and agent directories wherever they
are in a repo — at the root, under `.claude/`, one per plugin, or all three at
once. It is the default for a git source, since a repo you point at is not
necessarily one you laid out. **`paths`** narrows the scan to part of a source.

### Changed

- **`--prune` is bounded by what skillwire installed**, recorded per wire and
  target, rather than by what is absent from the source. Artifacts belonging to
  another wire, installed by hand, or shipped by the harness are never removed —
  and artifacts whose ids changed, because a prefix was added or a layout moved,
  now *are*.
- **`install` names what it added**, the way prune already named what it
  removed.
- Colour switches off when output is not a terminal, and honours `NO_COLOR`.

### Fixed

- **A description written as a YAML block scalar broke the layout.** It keeps
  its line breaks, and the picker drew every one: a single skill became six
  rows, the list outgrew its panel, and the border and the filter strip below
  it were pushed off the screen. Anything that has to occupy one row is now
  collapsed to one.

- **The preview dropped lines out of the middle of a file.** Its rows were
  shrinkable, so a block taller than the panel had the layout squeeze rows out
  rather than cut the tail — a file rendered with pieces missing from it.

- **YAML block scalars in frontmatter were dropped.** A skill written as
  `description: |` or `description: >` lost its description entirely.
- **A source path that does not exist is now an error**, not an empty read — a
  distinction that matters a great deal under `--prune`.
- **Two saves in quick succession could fail.** The interactive UI writes the
  config on every change, and two keypresses close together put two writes in
  flight over one temporary file.

### Breaking

- **Node 22 is the minimum**, up from 20, which reached end of life in April.
- Artifacts installed before this release have no prune record, so they cannot
  be pruned automatically. Remove them once by hand.

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
