import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';

/**
 * What kind of thing is being wired.
 *
 * The kinds differ in shape as well as destination:
 *
 *   skill    a directory containing SKILL.md, plus any supporting files
 *   command  a single .md file
 *   agent    a single .md file
 *
 * Targets accept different subsets — see Target.kinds.
 */
export type Kind = 'skill' | 'command' | 'agent';

export const KINDS: Kind[] = ['skill', 'command', 'agent'];

/** True when this kind is a directory rather than a single file. */
export function isDirKind(kind: Kind): boolean {
  return kind === 'skill';
}

/** Conventional source subdirectory for each kind. */
export const DEFAULT_KIND_DIR: Record<Kind, string> = {
  skill: 'skills',
  command: 'commands',
  agent: 'agents',
};

export interface ArtifactFile {
  /** Relative to the artifact root, POSIX separators. */
  path: string;
  bytes: Buffer;
}

export interface Artifact {
  kind: Kind;
  /** Directory name, or filename without .md. Authoritative — frontmatter `name` drifts. */
  id: string;
  /** Frontmatter `name`, falling back to the id. */
  name: string;
  description: string;
  /** Markdown with frontmatter stripped. */
  body: string;
  /** Complete file including frontmatter, for targets that copy verbatim. */
  raw: string;
  /**
   * Every file belonging to the artifact. For file kinds this is a single
   * entry whose path is the filename, so targets can treat all kinds alike.
   */
  files: ArtifactFile[];
  /** Frontmatter keys beyond name/description. */
  meta: Record<string, string>;
  /** Absolute path on disk: the directory for skills, the file for others. */
  path: string;
  /** Source grouping, e.g. the plugin a thing came from. */
  group?: string;
}

/**
 * Parse YAML frontmatter without a YAML dependency.
 *
 * Deliberately minimal: frontmatter in the wild is flat `key: value` pairs, and
 * the keys anything depends on are name and description. Nested structures are
 * kept as raw text rather than parsed, so an artifact using them still installs.
 *
 * Returns the body unchanged when there is no frontmatter. Real repos contain
 * files without it, and refusing to install those would be wrong.
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
      meta[key] += '\n' + line;
    }
  }
  for (const k of Object.keys(meta)) meta[k] = meta[k]!.trim();
  return { meta, body };
}

async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === '.DS_Store') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(root, full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function build(
  kind: Kind,
  id: string,
  path: string,
  raw: string,
  files: ArtifactFile[],
  group?: string,
): Artifact {
  const { meta, body } = parseFrontmatter(raw);
  const { name, description, ...rest } = meta;
  return {
    kind,
    id,
    name: name || id,
    description: description || '',
    body,
    raw,
    files,
    meta: rest,
    path,
    group,
  };
}

/**
 * Read a skill directory. Throws when it has no SKILL.md — that is the marker.
 *
 * `id` is supplied by the source rather than derived from the directory name,
 * because a skill's identity is its path within the repo. See sources.ts.
 */
export async function readSkillDir(
  dir: string,
  group?: string,
  id?: string,
): Promise<Artifact> {
  let raw: string;
  try {
    raw = await readFile(join(dir, 'SKILL.md'), 'utf8');
  } catch {
    throw new Error(`not a skill (no SKILL.md): ${dir}`);
  }
  const files: ArtifactFile[] = [];
  for (const f of await walk(dir)) {
    files.push({ path: relative(dir, f).split(sep).join('/'), bytes: await readFile(f) });
  }
  return build('skill', id ?? dir.split(sep).filter(Boolean).pop()!, dir, raw, files, group);
}

/** Read a single-file artifact (command or agent). */
export async function readFileArtifact(
  kind: Kind,
  file: string,
  group?: string,
  id?: string,
): Promise<Artifact> {
  const bytes = await readFile(file);
  const raw = bytes.toString('utf8');
  return build(
    kind,
    id ?? basename(file).replace(/\.md$/i, ''),
    file,
    raw,
    [{ path: basename(file), bytes }],
    group,
  );
}

export async function isSkillDir(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, 'SKILL.md'))).isFile();
  } catch {
    return false;
  }
}
