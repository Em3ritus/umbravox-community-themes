// Test helper (not a test): build zip files by hand, including the malformed ones the reader must refuse.
import zlib from 'node:zlib';

const enc = new TextEncoder();
let table = null;
export function crc32(data) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// entries: [{name, data, deflate?, method?, flags?, attr?, crc?, usize?, csize?, raw?}]
//   deflate: store compressed (method 8). method/flags/attr/crc/usize/csize: override what is written.
//   raw: the bytes to put in the file in place of the (possibly compressed) data.
export function zip(entries, opts = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), data = e.data ?? new Uint8Array(0);
    const method = e.method ?? (e.deflate ? 8 : 0);
    const body = e.raw ?? (e.deflate ? new Uint8Array(zlib.deflateRawSync(data)) : data);
    const crc = e.crc ?? crc32(data), usize = e.usize ?? data.length, csize = e.csize ?? body.length, flags = e.flags ?? 0x0800;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, flags, true); lh.setUint16(8, method, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, csize, true); lh.setUint32(22, usize, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, (3 << 8) | 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, flags, true);
    ch.setUint16(10, method, true); ch.setUint32(16, crc, true); ch.setUint32(20, csize, true); ch.setUint32(24, usize, true);
    ch.setUint16(28, name.length, true); ch.setUint32(38, e.attr ?? 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, opts.count ?? entries.length, true); end.setUint16(10, opts.count ?? entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer), ...(opts.trailer ? [opts.trailer] : [])];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

export const text = (s) => enc.encode(s);
export const THEME = text('{"format":1,"name":"EMBER"}');
