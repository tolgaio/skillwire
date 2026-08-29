import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** A file inside a skill, path relative to the skill root, POSIX separators. */
export interface SkillFile {
  path: string;
  bytes: Buffer;
}

export interface Skill {
  /** Directory name. Authoritative: frontmatter `name` is advisory and often drifts. */
  id: string;
  /** Frontmatter `name`, falling back to the directory name. */
  name: string;
  description: string;
  /** SKILL.md with frontmatter stripped. Targets that store metadata separately want this. */
  body: string;
  /** Complete SKILL.md including frontmatter. Targets that copy files verbatim want this. */
  raw: string;
  /** Every file under the skill root, SKILL.md included. */
  files: SkillFile[];
  /** Frontmatter keys beyond name/description, preserved so targets can use or re-emit them. */
  meta: Record<string, string>;
  /** Absolute path this skill was read from. */
  dir: string;
  /** Grouping from the source, e.g. the plugin a skill came from. Targets may ignore it. */
  group?: string;
}

/**
 * Parse YAML frontmatter without a YAML dependency.
 *
 * Deliberately minimal: skill frontmatter in the wild is flat `key: value`
 * pairs, and the only two keys anything depends on are name and description.
 * Nested structures are kept as their raw text rather than parsed, so a skill
 * using them still installs — it just does not get structured metadata.
 *
 * Returns the body unchanged when there is no frontmatter. Real skill repos
 * contain skills without it, and refusing to install those would be wrong.
 */
export function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
  if (!raw.startsWith('---')) return { meta: {}, body: raw };

  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: raw };

  const block = raw.slice(raw.indexOf('\n') + 1, end);
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1);

  const meta: Record<string, string> = {};
  let key: string | null = null;
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s?(.*)$/.exec(line);
    if (m) {
      key = m[1]!;
      meta[key] = m[2] ?? '';
    } else if (key && /^\s+\S/.test(line)) {
      // continuation or nested block: keep it attached to the key verbatim
      meta[key] += '\n' + line;
    }
  }
  for (const k of Object.keys(meta)) meta[k] = meta[k]!.trim();
  return { meta, body };
}

async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    // Skip VCS and editor noise; a skill is content, not a checkout.
    if (e.name === '.git' || e.name === '.DS_Store') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(root, full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** Read one skill directory. Throws if it has no SKILL.md — that is the marker. */
export async function readSkill(dir: string, group?: string): Promise<Skill> {
  const skillMd = join(dir, 'SKILL.md');
  let raw: string;
  try {
    raw = await readFile(skillMd, 'utf8');
  } catch {
    throw new Error(`not a skill (no SKILL.md): ${dir}`);
  }

  const { meta, body } = parseFrontmatter(raw);
  const id = dir.split(sep).filter(Boolean).pop()!;

  const files: SkillFile[] = [];
  for (const f of await walk(dir)) {
    files.push({
      path: relative(dir, f).split(sep).join('/'),
      bytes: await readFile(f),
    });
  }

  const { name, description, ...rest } = meta;
  return {
    id,
    name: name || id,
    description: description || '',
    body,
    raw,
    files,
    meta: rest,
    dir,
    group,
  };
}

/** True when a directory looks like a skill. */
export async function isSkillDir(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, 'SKILL.md'))).isFile();
  } catch {
    return false;
  }
}
