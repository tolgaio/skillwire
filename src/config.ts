import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { FlatSource, NestedSource, type KindDirs, type Source } from './sources.js';
import type { Kind } from './artifact.js';
import type { Target } from './targets/base.js';
import { claudeCode, pi } from './targets/filesystem.js';
import { hermes } from './targets/hermes.js';
import { multica } from './targets/multica.js';

export interface SourceConfig {
  /** Repo root. Each kind is read from a subdirectory of it. */
  path: string;
  /**
   * flat   <path>/<kindDir>/...
   * nested <path>/<group>/<kindDir>/...   (Claude Code plugin marketplaces)
   */
  layout?: 'flat' | 'nested';
  /** Override the subdirectory for a kind, e.g. { "command": "prompts" }. */
  dirs?: KindDirs;
}

export type TargetConfig = string | ({ id: string } & Record<string, unknown>);

export interface Wire {
  name: string;
  source: SourceConfig;
  targets: TargetConfig[];
  /** Which kinds to wire. Defaults to all of them. */
  kinds?: Kind[];
  /** Install only these skill ids. Omit for all. */
  only?: string[];
  /** Never install these skill ids. */
  exclude?: string[];
}

export interface Config {
  wires: Wire[];
}

export function expandPath(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(p);
}

export function buildSource(cfg: SourceConfig): Source {
  const path = expandPath(cfg.path);
  return cfg.layout === 'nested'
    ? new NestedSource(path, cfg.dirs ?? {}, cfg.path)
    : new FlatSource(path, cfg.dirs ?? {}, cfg.path);
}

export function buildTarget(cfg: TargetConfig): Target {
  const { id, ...opts } = typeof cfg === 'string' ? { id: cfg } : cfg;
  switch (id) {
    case 'claude':
      return claudeCode();
    case 'pi':
      return pi();
    case 'hermes':
      return hermes(opts as Parameters<typeof hermes>[0]);
    case 'multica':
      return multica(opts as Parameters<typeof multica>[0]);
    default:
      throw new Error(
        `unknown target "${id}" (known: claude, pi, hermes, multica)`,
      );
  }
}

export const CONFIG_NAMES = ['skillwire.config.json', '.skillwire.json'];

export async function loadConfig(explicit?: string): Promise<{ config: Config; path: string }> {
  const candidates = explicit
    ? [expandPath(explicit)]
    : [
        ...CONFIG_NAMES.map((n) => resolve(n)),
        ...CONFIG_NAMES.map((n) => join(homedir(), '.config', 'skillwire', n)),
      ];

  for (const p of candidates) {
    try {
      const raw = await readFile(p, 'utf8');
      const config = JSON.parse(raw) as Config;
      if (!Array.isArray(config.wires))
        throw new Error(`${p}: expected a "wires" array`);
      return { config, path: p };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
  }
  throw new Error(
    `no config found (looked for ${CONFIG_NAMES.join(', ')} here and in ~/.config/skillwire)`,
  );
}
