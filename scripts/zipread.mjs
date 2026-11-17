// Read a submitted theme zip. The zip comes from a stranger, so this accepts exactly one shape and refuses the rest:
// one folder whose name the device would accept, holding only theme.json, emblem.bin, radar.vid and alert.snd,
// stored or deflated, within the size limits. Nothing is written to disk here; the caller gets bytes.
import zlib from 'node:zlib';

export const LIMITS = { zipBytes: 2097152, entries: 5, totalBytes: 2097152 };
export const PACK_FILES = ['theme.json', 'emblem.bin', 'radar.vid', 'alert.snd'];
export const FOLDER_RE = /^[A-Za-z0-9_-]{1,31}$/;

let table = null;
function crc32(data) {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const no = (error) => ({ ok: false, error });
const DAMAGED = 'The zip is damaged or is not a plain zip file.';

// -> {ok:true, folder, files:[{name, data}]} | {ok:false, error}
export function readZip(bytes, limits = LIMITS) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22) return no('That file is not a zip.');
  if (bytes.length > limits.zipBytes) return no('The zip is too big: ' + bytes.length + ' bytes, and the limit is ' + limits.zipBytes + '.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (dv.getUint32(0, true) !== 0x04034b50) return no('That file is not a zip.');

  // The end record is the last 22 bytes plus a comment whose stated length must reach the end of the file exactly.
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65535; i--) {
    if (dv.getUint32(i, true) === 0x06054b50 && i + 22 + dv.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) return no(DAMAGED);
  const count = dv.getUint16(end + 10, true), cdSize = dv.getUint32(end + 12, true), cdOff = dv.getUint32(end + 16, true);
  if (dv.getUint16(end + 4, true) !== 0 || dv.getUint16(end + 6, true) !== 0 || dv.getUint16(end + 8, true) !== count) return no(DAMAGED);
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) return no(DAMAGED);          // zip64
  if (count === 0) return no('The zip is empty.');
  if (count > limits.entries) return no('The zip has too many entries (' + count + '). A theme is one folder with at most four files.');
  if (cdOff + cdSize > end || cdOff + cdSize < cdOff) return no(DAMAGED);

  const dec = new TextDecoder('utf-8', { fatal: true });
  let folder = null, total = 0, p = cdOff;
  const files = [], seen = new Set();
  for (let n = 0; n < count; n++) {
    if (p + 46 > cdOff + cdSize || dv.getUint32(p, true) !== 0x02014b50) return no(DAMAGED);
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const madeBy = dv.getUint16(p + 4, true) >> 8, attr = dv.getUint32(p + 38, true), lho = dv.getUint32(p + 42, true);
    if (p + 46 + nameLen + extraLen + commentLen > cdOff + cdSize) return no(DAMAGED);
    let name;
    try { name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)); } catch (e) { return no('A file name in the zip is not readable text.'); }
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x0001) return no('The zip is encrypted. Zip the theme folder without a password.');
    if (madeBy === 3 && ((attr >>> 16) & 0o170000) === 0o120000) return no('The zip holds a link, not a file. A theme is plain files only.');
    if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return no('A name in the zip is not allowed: ' + JSON.stringify(name) + '.');
    const isDir = name.endsWith('/');
    const segs = (isDir ? name.slice(0, -1) : name).split('/');
    if (segs.some((s) => s === '' || s === '.' || s === '..')) return no('A name in the zip is not allowed: ' + JSON.stringify(name) + '.');
    if (segs.length > 2 || (isDir && segs.length !== 1)) return no('A name in the zip is not allowed: ' + JSON.stringify(name) + '. A theme is one folder with its files directly inside.');
    if (!isDir && segs.length === 1) return no('The files must be inside one theme folder, as the designer zips them.');
    if (!FOLDER_RE.test(segs[0])) return no('The theme folder name ' + JSON.stringify(segs[0]) + ' is not allowed. Use letters, digits, - and _ only, 31 characters at most.');
    if (folder !== null && folder !== segs[0]) return no('The zip must hold exactly one folder; it has ' + JSON.stringify(folder) + ' and ' + JSON.stringify(segs[0]) + '.');
    folder = segs[0];
    if (isDir) { if (usize !== 0 || csize > 2) return no(DAMAGED); continue; }

    const base = segs[1];
    if (!PACK_FILES.includes(base)) return no(JSON.stringify(base) + ' is not a theme file. A theme holds only ' + PACK_FILES.join(', ') + '.');
    if (seen.has(base)) return no(base + ' is in the zip twice.');
    seen.add(base);
    if (method !== 0 && method !== 8) return no(base + ' uses a compression method that is not supported. Zip the folder the ordinary way.');
    if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF) return no(DAMAGED);
    total += usize;
    if (usize > limits.totalBytes || total > limits.totalBytes) return no('The theme is too big when unpacked; the limit is ' + limits.totalBytes + ' bytes.');
    if (method === 0 && csize !== usize) return no(DAMAGED);

    if (lho + 30 > cdOff || dv.getUint32(lho, true) !== 0x04034b50) return no(DAMAGED);
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    if (start + csize > cdOff || start + csize < start) return no(DAMAGED);
    const body = bytes.subarray(start, start + csize);
    let data;
    if (method === 0) data = new Uint8Array(body);
    else {
      // maxOutputLength makes zlib stop, and throw, as soon as the output would pass the declared size.
      try { data = new Uint8Array(zlib.inflateRawSync(body, { maxOutputLength: Math.max(usize, 1) })); }
      catch (e) { return no(base + ' does not unpack to the size the zip states for it.'); }
    }
    if (data.length !== usize) return no(base + ' does not unpack to the size the zip states for it.');
    if (crc32(data) !== crc) return no(base + ' fails its checksum; the zip is damaged.');
    files.push({ name: base, data });
  }
  if (p !== cdOff + cdSize) return no(DAMAGED);
  if (!seen.has('theme.json')) return no('The zip has no theme.json, so it is not a theme.');
  files.sort((a, b) => PACK_FILES.indexOf(a.name) - PACK_FILES.indexOf(b.name));
  return { ok: true, folder, files };
}
