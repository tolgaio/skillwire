import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A record of what each wire installed, per target.
 *
 * Prune needs to answer "did I put this here?", and neither of the obvious
 * alternatives can:
 *
 *   - "remove anything not in the source" deletes artifacts belonging to other
 *     wires, and anything the user installed by hand
 *   - "remove anything matching this wire's prefix" cannot see artifacts the
 *     wire installed under a *previous* name, so adding or changing a prefix
 *     strands the old set permanently with no way to reach it
 *
 * The manifest has neither problem: it remembers the ids a wire actually wrote,
 * so a rename is just "these ids are no longer produced" and prune removes
 * exactly them.
 */
export interface Manifest {
  version: 1;
  /** wire name -> target id -> ids installed on the last successful run */
  wires: Record<string, Record<string, string[]>>;
}

const EMPTY: Manifest = { version: 1, wires: {} };

export function manifestPath(): string {
  const xdg = process.env.XDG_STATE_HOME;
  return xdg
    ? join(xdg, 'skillwire', 'manifest.json')
    : join(homedir(), '.local', 'state', 'skillwire', 'manifest.json');
}

export async function readManifest(path = manifestPath()): Promise<Manifest> {
  try {
    const m = JSON.parse(await readFile(path, 'utf8')) as Manifest;
    // A manifest from a future version is not safe to reason about: acting on a
    // shape we do not understand risks deleting the wrong things. Treat it as
    // absent, which degrades prune to a no-op rather than a hazard.
    if (m.version !== 1 || typeof m.wires !== 'object') return { ...EMPTY };
    return m;
  } catch {
    return { ...EMPTY };
  }
}

export async function writeManifest(m: Manifest, path = manifestPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

/** Ids this wire installed at this target on its last run. */
export function previouslyInstalled(m: Manifest, wire: string, target: string): string[] {
  return m.wires[wire]?.[target] ?? [];
}

export function record(m: Manifest, wire: string, target: string, ids: string[]): Manifest {
  return {
    ...m,
    wires: { ...m.wires, [wire]: { ...(m.wires[wire] ?? {}), [target]: [...ids].sort() } },
  };
}
