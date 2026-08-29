# skillwire

Push [Agent Skills](https://agentskills.io) from one source of truth into every agent that can use them — **including ones that aren't filesystems**.

You keep skills in a git repo. skillwire installs them natively into each agent, so you get that agent's own skill support: progressive disclosure in Claude Code, `/skill:name` in pi, category grouping in Hermes, workspace skills in Multica.

```bash
npx skillwire install
```

## Why not just symlink?

Because not every agent reads a directory.

| target | destination | shape |
|---|---|---|
| Claude Code | `~/.claude/skills/` | flat `SKILL.md` trees |
| pi | `~/.pi/agent/skills/` | flat `SKILL.md` trees |
| Hermes | `~/.hermes/skills/<category>/` | grouped, with `DESCRIPTION.md` |
| Multica | PostgreSQL, via its API | zip uploaded through the CLI |

Existing tools model a target as *a path to copy into*. That works for three of those four. Multica stores skills in a database, so it can't be expressed that way at all — which is why skillwire's target interface is a behaviour rather than a path:

```ts
interface Target {
  install(skills: Skill[], opts: InstallOptions): Promise<InstallResult>;
}
```

Anything that can accept a skill can be a target: an API, a database, a container, a remote host.

## Install

```bash
npm i -g skillwire     # or: npx skillwire
```

Requires Node 20+. No runtime dependencies.

## Configure

`skillwire.config.json`, in the current directory or `~/.config/skillwire/`:

```json
{
  "wires": [
    {
      "name": "personal",
      "source": { "path": "~/src/my-skills", "layout": "flat" },
      "targets": ["claude", "pi"]
    },
    {
      "name": "work",
      "source": { "path": "~/src/team-skills/plugins", "layout": "nested" },
      "targets": [
        "claude",
        { "id": "hermes", "defaultCategory": "work" },
        { "id": "multica", "workspace": "work", "onConflict": "overwrite" }
      ]
    }
  ]
}
```

A **wire** connects one source to many targets. Two wires can feed the same target — personal and work skills both landing in Claude Code — while going to different places elsewhere.

### Source layouts

- `flat` — `<path>/<skill>/SKILL.md`. Most skill repos.
- `nested` — `<path>/<group>/skills/<skill>/SKILL.md`. The Claude Code plugin-marketplace layout. The group travels with the skill, so targets that organise by category (Hermes) use it and targets that don't (Claude Code, pi, Multica) ignore it.

### Filtering

`only` and `exclude` take skill ids, so one repo can feed different subsets to different targets.

## Use

```bash
skillwire list                        # what each wire would install
skillwire targets                     # which targets exist on this machine
skillwire install --dry-run           # report, write nothing
skillwire install                     # do it
skillwire install --wire work --target multica
skillwire install --prune             # also remove skills no longer in the source
```

## Safety

**skillwire refuses to install into its own source.** The usual way to expose skills to Claude Code is to symlink `~/.claude/skills` at the repo holding them — which makes the target resolve *back to the source*. Since installing replaces each skill directory, that would rewrite your repo in place, and pointing a second source at the same target would overwrite one repo's skills with another's. Both paths are resolved through symlinks before comparing:

```
fail  claude  refusing to install: Claude Code resolves to
      /home/you/src/my-skills/skills, which is inside the source ...
```

If you currently symlink, remove the link and let skillwire own the directory.

**`--prune` is not supported for Multica.** Deleting there would remove skills other people may have created in a shared workspace, and would discard the agent assignments attached to them.

## Targets

### Multica

Skills are uploaded with `multica skill import --file`, not `--url`. The URL form records an origin and enables `skill refresh`, but the import runs **server-side** — the backend fetches the URL itself, so it only works for repos the backend can read. Uploading the bytes needs no credentials, which is what makes private skill repos work.

The trade-off: a `--file` import records no origin, so `skill refresh` can't re-pull it. Re-running skillwire is the refresh.

Multica's CLI is scoped to one workspace. Set `workspace` to switch first — but note that changes the profile default, which a local daemon also reads, so it's explicit rather than automatic.

### Hermes

Hermes nests skills one level deeper, under a category, with a `DESCRIPTION.md` per category. The category comes from the source group when there is one, otherwise `defaultCategory`.

skillwire only touches categories it installs into, so Hermes's own bundled skills are never disturbed, and it writes `DESCRIPTION.md` only when absent so a hand-written one is never clobbered.

Running Hermes in a container is fine: with `-v ~/.hermes:/opt/data` and `HERMES_HOME=/opt/data`, the host path is the right thing to write to.

## Adding a target

Implement `Target` and register it in `src/config.ts`:

```ts
export class MyTarget implements Target {
  readonly id = 'mine';
  readonly name = 'My Agent';
  async detect() { return true; }
  async install(skills, opts) { /* ... */ }
}
```

There's no requirement to be a filesystem.

## License

MIT
