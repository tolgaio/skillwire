#!/usr/bin/env node
/**
 * Pull one version's section out of RELEASES.md, as GitHub wants it.
 *
 *   node scripts/release-notes.mjs 0.0.2
 *
 * RELEASES.md is wrapped to eighty columns, which is right for a file people
 * read in an editor and wrong for a release body: GitHub renders those with
 * GFM's soft-break-as-hard-break rule, the same as a comment, so every wrap
 * becomes a line break and the notes stop dead at eighty characters however
 * wide the page is. Paragraphs are unwrapped back into single lines here;
 * headings, tables, list markers and fenced code are left exactly as they are.
 */
import { readFile } from 'node:fs/promises';

const version = process.argv[2];
if (!version) {
  console.error('usage: release-notes.mjs <version>');
  process.exit(1);
}

const file = new URL('../RELEASES.md', import.meta.url);
const doc = await readFile(file, 'utf8');

const heading = new RegExp(`^## ${version.replace(/\./g, '\\.')}(\\s|$)`, 'm');
const start = doc.search(heading);
if (start === -1) {
  console.error(`no "## ${version}" section in RELEASES.md`);
  process.exit(1);
}
const rest = doc.slice(start);
const next = rest.slice(1).search(/^## /m);
const section = next === -1 ? rest : rest.slice(0, next + 1);

// Drop the version heading itself: GitHub already titles the release.
const body = section.slice(section.indexOf('\n') + 1);

console.log(unwrap(body).trim());

/** Join the lines of each paragraph, leaving structure alone. */
function unwrap(markdown) {
  const out = [];
  let paragraph = [];
  let fenced = false;

  const flush = () => {
    if (paragraph.length) out.push(paragraph.join(' '));
    paragraph = [];
  };

  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      flush();
      fenced = !fenced;
      out.push(line);
      continue;
    }
    if (fenced) {
      out.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      out.push('');
      continue;
    }
    // A table row, a heading or a rule stands alone. A list item starts a new
    // paragraph that its own indented continuation lines join.
    if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      flush();
      paragraph.push(line);
      continue;
    }
    if (/^(#{1,6} |\||---+$)/.test(line.trim()) || line.trim().startsWith('|')) {
      flush();
      out.push(line);
      continue;
    }
    paragraph.push(paragraph.length ? line.trim() : line);
  }
  flush();

  // A rule at the end is a separator between sections in the file, not part of
  // the notes.
  while (out.length && (out[out.length - 1].trim() === '' || out[out.length - 1].trim() === '---')) {
    out.pop();
  }
  return out.join('\n');
}
