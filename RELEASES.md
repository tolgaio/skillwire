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

- Test suite covering the ZIP writer, frontmatter parsing, source discovery and
  id derivation, filter matching, and the filesystem target including its prune
  and containment behaviour.
- CI on Linux and macOS, Node 20/22/24.

### Changed

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
