import { deflateRawSync } from 'node:zlib';

/**
 * Minimal ZIP writer.
 *
 * Written out rather than pulled in as a dependency for two reasons: this is
 * the only place skillwire needs compression, and the tool runs on servers
 * where `zip` is often absent (it is not installed on a stock Ubuntu server
 * image, which is exactly where a multica host tends to live).
 *
 * Deliberately supports only what a skill archive needs: deflate, no
 * encryption, no zip64, no directory entries. Skills are text and small
 * scripts; the 4GB and 65535-entry limits are not reachable in practice.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** POSIX-separated path inside the archive. */
  path: string;
  bytes: Buffer;
}

export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.path, 'utf8');
    const crc = crc32(e.bytes);
    const deflated = deflateRawSync(e.bytes);

    // Store uncompressed when deflate does not help; some readers are happier
    // with stored entries for tiny files, and it costs nothing to prefer the
    // smaller of the two.
    const useDeflate = deflated.length < e.bytes.length;
    const data = useDeflate ? deflated : e.bytes;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1 Jan 1980 is 0x21 as a valid date)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(e.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, name, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central directory signature
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(e.bytes.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk number
    cd.writeUInt16LE(0, 36); // internal attrs
    // >>> 0 because JS bitwise ops yield a *signed* 32-bit result, and
    // 0o100644 << 16 exceeds 2^31-1 — it arrives as a negative number and
    // writeUInt32LE rejects it.
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file, 0644
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuf, end]);
}
