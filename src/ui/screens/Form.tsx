import { Badge, TextInput } from '@inkjs/ui';
import { Box, Text} from 'ink';
import { useKeys } from '../useKeys.js';
import { useState, type ReactNode } from 'react';
import { TARGET_IDS, type SourceConfig, type Wire } from '../../config.js';
import { Check } from '../components/List.js';
import { Panel, Row } from '../components/chrome.js';
import { moveCursor, nav } from '../keys.js';
import { useStore } from '../store.js';
import { targetId } from './Sources.js';

export const FORM_KEYS: [string, string][] = [
  ['type', 'edit the field under the cursor'],
  ['⏎  tab', 'next field, or save on the last row'],
  ['↑ ↓', 'move between fields'],
  ['← →', 'change a choice, or move along the targets'],
  ['space', 'toggle a target'],
  ['c p h m', 'toggle a target by its initial'],
  ['^s', 'save from anywhere'],
];

export const FORM_HINTS: [string, string][] = [
  ['⏎', 'next'],
  ['←→', 'change'],
  ['space', 'toggle'],
  ['^s', 'save'],
  ['?', 'keys'],
  ['esc', 'cancel'],
];

interface FieldSpec {
  key: string;
  label: string;
  help: string;
  kind: 'text' | 'choice' | 'targets' | 'button';
  choices?: string[];
}

const FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Name', help: 'label, and what --wire matches', kind: 'text' },
  {
    key: 'kind',
    label: 'Source',
    help: 'a directory on this machine, or a repository to clone',
    kind: 'choice',
    choices: ['path', 'git'],
  },
  {
    key: 'location',
    label: 'Path / repo',
    help: '~/src/my-skills, or owner/name, or any URL git accepts',
    kind: 'text',
  },
  { key: 'ref', label: 'Ref', help: 'branch, tag or commit. git only, optional', kind: 'text' },
  {
    key: 'layout',
    label: 'Layout',
    help: 'auto finds kind directories anywhere; flat expects them at the root',
    kind: 'choice',
    choices: ['auto', 'flat', 'nested'],
  },
  {
    key: 'paths',
    label: 'Paths',
    help: 'comma-separated subdirectories to scan. Blank scans the whole source',
    kind: 'text',
  },
  {
    key: 'prefix',
    label: 'Prefix',
    help: 'namespaces ids as <prefix>-<id>. Optional',
    kind: 'text',
  },
  { key: 'targets', label: 'Targets', help: '← → to move along, space to toggle', kind: 'targets' },
  { key: 'save', label: '', help: 'writes the config and reads the source', kind: 'button' },
];

/**
 * Add or edit one source.
 *
 * Text fields take keys as soon as they have focus — no mode to enter first. A
 * form where typing does nothing until you press enter is a form people type a
 * name into and lose.
 */
export function Form({ index }: { index: number | null }): ReactNode {
  const store = useStore();
  const existing = index === null ? undefined : store.wireAt(index);
  const src = existing?.source;

  const [values, setValues] = useState<Record<string, string>>({
    name: existing?.name ?? '',
    location: src?.git ?? src?.path ?? '',
    ref: src?.ref ?? '',
    paths: (src?.paths ?? []).join(', '),
    prefix: existing?.prefix ?? '',
  });
  const [choice, setChoice] = useState<Record<string, string>>({
    kind: src?.git ? 'git' : 'path',
    layout: src?.layout ?? (src?.git ? 'auto' : 'flat'),
  });
  const [targets, setTargets] = useState(
    new Set(existing ? existing.targets.map(targetId) : ['claude']),
  );
  const [cursor, setCursor] = useState(0);
  const [targetCursor, setTargetCursor] = useState(0);

  const field = FIELDS[cursor]!;
  const step = (d: number): void => setCursor((c) => Math.max(0, Math.min(FIELDS.length - 1, c + d)));

  useKeys((input, key) => {
    if (key.ctrl && input === 's') return void submit();
    if (key.escape) return store.pop();
    if (key.upArrow || (key.tab && key.shift)) return step(-1);
    if (key.tab) return step(1);
    if (key.return) return field.kind === 'button' ? void submit() : step(1);
    if (key.downArrow && field.kind !== 'text') return step(1);

    if (field.kind === 'choice') {
      const options = field.choices!;
      const move = key.leftArrow ? -1 : key.rightArrow || input === ' ' ? 1 : 0;
      if (!move) return;
      const at = options.indexOf(choice[field.key] ?? options[0]!);
      return setChoice({ ...choice, [field.key]: options[(at + move + options.length) % options.length]! });
    }

    if (field.kind === 'targets') {
      if (key.leftArrow) return setTargetCursor((t) => (t + TARGET_IDS.length - 1) % TARGET_IDS.length);
      if (key.rightArrow) return setTargetCursor((t) => (t + 1) % TARGET_IDS.length);
      if (input === ' ') return toggleTarget(TARGET_IDS[targetCursor]!);
      // Initials, so picking three targets is three keys.
      const byInitial = TARGET_IDS.find((t) => t[0] === input);
      if (byInitial) return toggleTarget(byInitial);
      return;
    }

    if (key.downArrow) step(1);
  }, { isActive: field.kind !== 'text' && !store.help });

  // A text field owns its keys while focused; the navigator above is disabled
  // so hjkl stays typeable in a name or a path.
  useKeys(
    (input, key) => {
      if (key.ctrl && input === 's') return void submit();
      if (key.escape) return store.pop();
      if (key.upArrow) return step(-1);
      if (key.downArrow || key.tab || key.return) return step(1);
    },
    { isActive: field.kind === 'text' && !store.help },
  );

  function toggleTarget(id: string): void {
    const next = new Set(targets);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTargets(next);
  }

  async function submit(): Promise<void> {
    const name = values.name!.trim();
    const location = values.location!.trim();
    try {
      if (!name) throw new Error('a source needs a name');
      if (!location) throw new Error('a source needs a path or a repository');
      const clash = store.config.wires.findIndex((w) => w.name === name);
      if (clash !== -1 && clash !== index) throw new Error(`there is already a wire "${name}"`);
      if (!targets.size) throw new Error('pick at least one target');
    } catch (err) {
      return store.say((err as Error).message, 'error');
    }

    const isGit = choice.kind === 'git';
    const source: SourceConfig = isGit ? { git: location } : { path: location };
    const ref = values.ref!.trim();
    if (isGit && ref) source.ref = ref;
    source.layout = choice.layout as SourceConfig['layout'];
    const paths = values.paths!.split(',').map((p) => p.trim()).filter(Boolean);
    if (paths.length) source.paths = paths;

    const wire: Wire = {
      ...(existing ?? {}),
      name,
      source,
      // Keep any hand-written target options ({ id, workspace, … }); only the
      // set of ids is editable here.
      targets: [...targets].map((id) => existing?.targets.find((t) => targetId(t) === id) ?? id),
    };
    const prefix = values.prefix!.trim();
    if (prefix) wire.prefix = prefix;
    else delete wire.prefix;

    if (index === null) await store.addWire(wire);
    else await store.replaceWire(index, wire);

    store.invalidate(wire);
    store.pop();
    const loaded = await store.load(wire, isGit);
    store.say(
      loaded.error ?? `${name}: ${loaded.artifacts.length} artifacts`,
      loaded.error ? 'error' : 'ok',
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Panel title={index === null ? 'add a source' : `edit ${existing!.name}`} grow>
        {FIELDS.map((f, i) => {
          const here = i === cursor;
          if (f.kind === 'button') {
            return (
              <Box key={f.key} marginTop={1} flexShrink={0}>
                <Text color={here ? 'cyan' : undefined}>{here ? '▸ ' : '  '}</Text>
                <Text inverse={here} dimColor={!here}>
                  {' Save '}
                </Text>
              </Box>
            );
          }
          return (
            <Box key={f.key} flexShrink={0}>
              <Text color={here ? 'cyan' : undefined}>{here ? '▸ ' : '  '}</Text>
              <Row label={f.label} width={13}>
                {f.kind === 'text' ? (
                  here ? (
                    <TextInput
                      defaultValue={values[f.key]}
                      placeholder="…"
                      onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
                    />
                  ) : (
                    <Text dimColor={!values[f.key]}>{values[f.key] || '—'}</Text>
                  )
                ) : f.kind === 'choice' ? (
                  <Box>
                    {f.choices!.map((option) => (
                      <Box key={option} marginRight={1}>
                        {choice[f.key] === option ? (
                          <Badge color="cyan">{option}</Badge>
                        ) : (
                          <Text dimColor>{option}</Text>
                        )}
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Box>
                    {TARGET_IDS.map((t, ti) => (
                      <Box key={t} marginRight={2}>
                        <Check on={targets.has(t)} />
                        <Text underline={here && ti === targetCursor} dimColor={!targets.has(t)}>
                          {' '}
                          {t}
                        </Text>
                      </Box>
                    ))}
                  </Box>
                )}
              </Row>
            </Box>
          );
        })}
      </Panel>
      <Box paddingX={1} flexShrink={0} flexDirection="column">
        <Text dimColor>{field.help}</Text>
        {choice.kind === 'path' && values.ref ? (
          <Text color="yellow">ref applies to a git source only; it will not be saved</Text>
        ) : null}
      </Box>
    </Box>
  );
}

