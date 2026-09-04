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

## 0.0.3 — 2026-09-04

Mostly the interactive picker, which now looks and behaves like something you
would leave open.

### Added

**Skills, commands and agents are tabs** — each counted, one listed at a time,
`tab` to cycle or `1`–`3` to jump. **A collection is a folder**: one collapsible
row rather than two hundred, indented when opened. Together they turn a source
of five hundred into a page you can read.

**The preview panel shows the file**, not only the description, with enough
markdown rendering to read a SKILL.md by. `[` and `]` scroll it, as does the
wheel, and `p` puts it away when the list wants the width.

**`include`, a third filter, matched after `exclude`.** Keeping one skill out of
an excluded collection of two hundred used to mean giving up the pattern that
excludes the other hundred and ninety-nine. Ticking such an artifact now names
it and leaves the pattern alone.

A filled circle marks a picked row, the open tab carries its own colour, and the
filters moved to a grey strip along the bottom.

### Changed

- **An `only` list scoped to one kind leaves the other kinds alone.** `only` is
  a whitelist, so anything it did not name was dropped — including whole kinds
  it never mentioned, which made `only: ["command:review"]` mean "one command,
  and no skills or agents at all". Naming a kind is a statement about that kind.
  One unscoped pattern still speaks for all of them.

### Fixed

- **A description written as a YAML block scalar broke the layout.** It keeps
  its line breaks, and every one was drawn: one skill became six rows, the list
  outgrew its panel, and the border and the strip below it were pushed off the
  screen.
- **Opening a folder scrolled the list.** The window was centred on the cursor,
  so a collection arriving under it moved every row above. It is sticky now.
- **Escape did nothing while typing a filter pattern or a search.** The text
  field does not handle it either, so there was no way to abandon one.
- **The preview cut every line off** rather than wrapping it, and dropped lines
  out of the middle of long files.

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
