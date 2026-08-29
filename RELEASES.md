# Releases

## Versioning

skillwire follows [semantic versioning](https://semver.org). While on `0.x` the
API is not stable: **breaking changes may land in a minor bump**, and will
always be called out under a `Breaking` heading below.

Three things count as breaking, and all three are user-visible:

- a change to the **config schema** — a renamed or removed field, or a changed default
- a change to how **ids are derived**, since ids are what gets installed and what
  `only`/`exclude` match. An id change silently orphans previously installed
  artifacts, which `--prune` then removes
- a change to where a **target writes**

Each release states what has been exercised against real systems and what has
not, because "the code path ran" and "it works" are different claims.

---

## 0.0.1 — 2026-08-29

First tagged release. Usable, and honest about being early.

### What it does

Pushes skills, commands and agents from one or more source repositories into
every agent that can use them, natively — so each agent's own support applies
rather than a lowest common denominator.

**Targets**

| target | kinds | destination |
|---|---|---|
| `claude` | skill, command, agent | `~/.claude/{skills,commands,agents}/` |
| `pi` | skill, command | `~/.pi/agent/{skills,prompts}/` |
| `hermes` | skill | `~/.hermes/skills/<category>/` |
| `multica` | skill, agent | PostgreSQL, via its CLI |

Multica is the reason the target interface is `install(artifacts)` rather than a
directory path: it stores skills in a database, so it cannot be expressed as a
place to copy files to.

**Sources** — `flat` (`<root>/skills/<skill>/`) and `nested`
(`<root>/<group>/skills/<skill>/`, the Claude Code plugin-marketplace layout),
with skills discovered at any depth below those.

**Ids** are an artifact's path within its kind directory, dash-joined
(`skills/writing/tone-check/` → `writing-tone-check`). Targets install into one
flat namespace, so hierarchies must flatten; basenames alone collide.

**Filtering** — by kind, and by `only`/`exclude` glob patterns which can be
scoped to a single kind (`skill:vendored-*`).

**Namespacing** — an optional per-wire `prefix`, for when two sources hold an
artifact with the same id.

**Safety**

- refuses to install into its own source, resolving symlinks first, because
  symlinking `~/.claude/skills` at the source repo is the conventional setup and
  would otherwise rewrite the repo in place
- `--dry-run` on everything
- `--prune` is opt-in, scoped to a wire's prefix, and on multica bounded to
  skills the authenticated user created

### Verified against real systems

- **claude** — 27 skills, 238 commands and 3 agents installed on macOS;
  contents byte-identical to source; `--prune` correctly removed 232 stale
  entries and nothing else
- **multica** — 27 skills installed to a self-hosted instance on Linux;
  packaging, upload, prune and idempotency all confirmed against the database

### Not verified

- **pi** and **hermes** have only ever been dry-run. The code path executes and
  reports correctly, but neither has written a file. Hermes carries the most
  placement logic of any target (category grouping, `DESCRIPTION.md` creation),
  so it is the most likely to be wrong.
- **Multica agent** creation is implemented and type-checked but has not been
  run against a live workspace.

### Known limitations

- **No test suite.** `npm test` is declared but there are no test files. For a
  tool whose primary verbs are "overwrite" and "delete", this is the largest gap.
- **No CI.**
- **The ZIP writer is hand-rolled** — no dependency, deliberately, since the
  tool runs on servers where `zip` is often absent. It omits zip64 and directory
  entries, which skill archives do not need, and is validated only by Multica
  accepting its output.
- **Claude Code nested-skill support is assumed, not confirmed.** Flattening is
  required by Multica regardless, but whether Claude Code *needs* it is
  unverified — the documentation found describes project-tree nesting
  (`apps/web/.claude/skills/`), not subdirectories of the global skills
  directory.
- **`--prune` does not confirm.** The guard is remembering `--dry-run` first.
- **Multica `--file` imports record no origin**, so `skill refresh` cannot
  re-pull them. Re-running skillwire is the refresh. This is a deliberate
  trade: `--url` imports run server-side and so cannot read private repos.
- **Setting a Multica `workspace` changes the CLI profile default**, which a
  local daemon also reads. A dry run reports the switch rather than performing it.
- **Wires sharing a target need a `prefix`.** Without one, ids collide and each
  wire's `--prune` removes the other's artifacts. Documented, not enforced.

### Scale note

Claude Code loads every skill's name and description into context to decide
relevance, within a budget of roughly 1% of the model's context window. Past a
few hundred skills it drops descriptions while keeping names, so skills exist
but stop being matched. This is a property of Claude Code, not of skillwire, but
it shapes how many skills are worth wiring there.
