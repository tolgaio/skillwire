import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { zip, type ZipEntry } from './zip.js';

/**
 * A minimal ZIP *reader*, written for these tests.
 *
 * Deliberately not `unzip` in a subprocess: the point is to check the bytes
 * this module produces against the format, not against whatever a particular
 * machine happens to have installed. It walks the central directory rather than
 * the local headers, because that is what real readers do — an archive whose
 * central directory is wrong will fail in the wild even if its local headers
 * look fine.
 */
function readZip(buf: Buffer): Map<string, Buffer> {
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, 'no end-of-central-directory record');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(off), 0x02014b50, 'bad central directory signature');
    const method = buf.readUInt16LE(off + 10);
    const crc = buf.readUInt32LE(off + 16);
    const compSize = buf.readUInt32LE(off + 20);
    const rawSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);

    // follow the pointer into the local header and read the payload
    assert.equal(buf.readUInt32LE(localOff), 0x04034b50, `bad local header for ${name}`);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);

    const content = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    assert.equal(content.length, rawSize, `size mismatch for ${name}`);
    assert.equal(crc32(content), crc, `crc mismatch for ${name}`);

    out.set(name, content);
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const entry = (path: string, s: string): ZipEntry => ({ path, bytes: Buffer.from(s, 'utf8') });

test('round-trips a single file', () => {
  const files = readZip(zip([entry('SKILL.md', '# hello\n')]));
  assert.deepEqual([...files.keys()], ['SKILL.md']);
  assert.equal(files.get('SKILL.md')!.toString(), '# hello\n');
});

test('preserves nested paths with forward slashes', () => {
  const paths = ['SKILL.md', 'scripts/run.sh', 'docker/templates/page.html'];
  const files = readZip(zip(paths.map((p) => entry(p, `content of ${p}`))));
  assert.deepEqual([...files.keys()].sort(), [...paths].sort());
  for (const p of paths) assert.equal(files.get(p)!.toString(), `content of ${p}`);
});

test('round-trips content that compresses badly', () => {
  // Random bytes deflate larger than the input, which takes the stored branch.
  const bytes = Buffer.from(
    Array.from({ length: 4096 }, (_, i) => (i * 2654435761) % 256),
  );
  const files = readZip(zip([{ path: 'blob.bin', bytes }]));
  assert.deepEqual(files.get('blob.bin'), bytes);
});

test('round-trips content that compresses well', () => {
  const bytes = Buffer.from('a'.repeat(10_000), 'utf8');
  const archive = zip([{ path: 'repeat.txt', bytes }]);
  assert.ok(archive.length < bytes.length, 'compressible input should shrink');
  assert.deepEqual(readZip(archive).get('repeat.txt'), bytes);
});

test('round-trips utf-8 in both names and content', () => {
  const files = readZip(zip([entry('skills/café/SKILL.md', 'naïve — ✓')]));
  assert.equal(files.get('skills/café/SKILL.md')!.toString(), 'naïve — ✓');
});

test('handles an empty file', () => {
  const files = readZip(zip([{ path: 'empty', bytes: Buffer.alloc(0) }]));
  assert.equal(files.get('empty')!.length, 0);
});

test('handles an empty archive', () => {
  assert.equal(readZip(zip([])).size, 0);
});

test('external attributes stay within uint32', () => {
  // 0o100644 << 16 exceeds 2^31-1, and JS bitwise ops return a *signed* 32-bit
  // result — so without an unsigned coercion this throws while writing the
  // central directory. That bug shipped once; this pins it.
  const archive = zip([entry('SKILL.md', 'x')]);
  const eocd = archive.length - 22;
  const cdOff = archive.readUInt32LE(eocd + 16);
  const attrs = archive.readUInt32LE(cdOff + 38);
  assert.equal(attrs >>> 16, 0o100644, 'expected regular file, mode 0644');
  assert.ok(attrs >= 0 && attrs <= 0xffffffff);
});

test('many entries all survive', () => {
  const entries = Array.from({ length: 200 }, (_, i) => entry(`d${i % 7}/f${i}.md`, `body ${i}`));
  const files = readZip(zip(entries));
  assert.equal(files.size, 200);
  assert.equal(files.get('d3/f101.md')!.toString(), 'body 101');
});
