// Unpacking a submitted zip: one theme folder, only the four pack files, within strict limits. Anything else is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { readZip, LIMITS } from '../scripts/zipread.mjs';
import { zip, text, THEME } from './_zip.mjs';

const bad = (bytes, re, limits) => {
  const r = readZip(bytes, limits);
  assert.equal(r.ok, false, 'expected a refusal');
  assert.match(r.error, re);
};

test('the limits', () => {
  assert.deepEqual(LIMITS, { zipBytes: 2097152, entries: 5, totalBytes: 2097152 });
});

test('a zip shaped like the designer writes it is read byte for byte', () => {
  const emblem = new Uint8Array([1, 2, 3, 4, 5]);
  const r = readZip(zip([{ name: 'ember/theme.json', data: THEME }, { name: 'ember/emblem.bin', data: emblem }]));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.folder, 'ember');
  assert.deepEqual(r.files.map((f) => f.name), ['theme.json', 'emblem.bin']);
  assert.deepEqual([...r.files[0].data], [...THEME]);
  assert.deepEqual([...r.files[1].data], [...emblem]);
});

test('a re-zipped pack (deflate, with a folder entry) is read too', () => {
  const vid = new Uint8Array(5000).fill(7);
  const r = readZip(zip([{ name: 'ember/', data: new Uint8Array(0) }, { name: 'ember/theme.json', data: THEME, deflate: true }, { name: 'ember/radar.vid', data: vid, deflate: true }]));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.files.map((f) => f.name), ['theme.json', 'radar.vid']);
  assert.equal(r.files[1].data.length, 5000);
});

test('not a zip, an empty input and a truncated zip are refused', () => {
  bad(text('hello, not a zip at all'), /not a zip/i);
  bad(new Uint8Array(0), /not a zip/i);
  const z = zip([{ name: 'ember/theme.json', data: THEME }]);
  bad(z.subarray(0, z.length - 30), /not a zip|damaged/i);
});

test('a zip over the size limit is refused before it is read', () => {
  bad(new Uint8Array(LIMITS.zipBytes + 1), /too big/i);
});

test('names that leave the folder are refused', () => {
  for (const name of ['../theme.json', '/theme.json', 'ember/../theme.json', 'ember\\theme.json', 'a/b/theme.json', 'C:/ember/theme.json', 'ember//theme.json']) {
    bad(zip([{ name, data: THEME }]), /name|folder/i);
  }
});

test('a file at the top level, with no folder, is refused', () => {
  bad(zip([{ name: 'theme.json', data: THEME }]), /folder/i);
});

test('a folder name the device would not accept is refused', () => {
  for (const f of ['my theme', 'a.b', 'x'.repeat(32), 'thème']) bad(zip([{ name: f + '/theme.json', data: THEME }]), /folder/i);
});

test('two folders are refused', () => {
  bad(zip([{ name: 'a/theme.json', data: THEME }, { name: 'b/emblem.bin', data: THEME }]), /one folder/i);
});

test('a file that is not one of the four pack files is refused', () => {
  for (const n of ['readme.txt', 'preview.png', 'theme.json.exe', 'THEME.JSON', '.hidden']) {
    bad(zip([{ name: 'ember/theme.json', data: THEME }, { name: 'ember/' + n, data: THEME }]), /not a theme file/i);
  }
});

test('the same file twice is refused', () => {
  bad(zip([{ name: 'ember/theme.json', data: THEME }, { name: 'ember/theme.json', data: THEME }]), /twice/i);
});

test('a zip with no theme.json is refused', () => {
  bad(zip([{ name: 'ember/emblem.bin', data: THEME }]), /theme\.json/);
});

test('too many entries are refused', () => {
  const many = ['theme.json', 'emblem.bin', 'radar.vid', 'alert.snd'].map((n) => ({ name: 'ember/' + n, data: THEME }));
  bad(zip([{ name: 'ember/', data: new Uint8Array(0) }, ...many, { name: 'ember/x', data: THEME }]), /too many/i);
  bad(zip([{ name: 'ember/theme.json', data: THEME }], { count: 600 }), /too many|damaged/i);
});

test('a symbolic link entry is refused', () => {
  bad(zip([{ name: 'ember/theme.json', data: text('/etc/passwd'), attr: (0o120777 << 16) >>> 0 }]), /link/i);
});

test('an encrypted entry and an unknown compression method are refused', () => {
  bad(zip([{ name: 'ember/theme.json', data: THEME, flags: 0x0801 }]), /encrypted/i);
  bad(zip([{ name: 'ember/theme.json', data: THEME, method: 12 }]), /compression/i);
});

test('a checksum that does not match is refused', () => {
  bad(zip([{ name: 'ember/theme.json', data: THEME, crc: 12345 }]), /checksum/i);
});

test('a stored entry whose two sizes differ is refused', () => {
  bad(zip([{ name: 'ember/theme.json', data: THEME, usize: THEME.length + 4 }]), /size|damaged/i);
});

test('an entry that claims 10 bytes but inflates to 3 MB is refused by the inflate limit', () => {
  const bomb = new Uint8Array(zlib.deflateRawSync(new Uint8Array(3 * 1024 * 1024)));
  assert.ok(bomb.length < 10000, 'the bomb is small on disk');
  bad(zip([{ name: 'ember/theme.json', data: new Uint8Array(0), method: 8, raw: bomb, usize: 10, crc: 0 }]), /size|too big/i);
});

test('entries whose declared sizes add up past the total limit are refused', () => {
  const half = new Uint8Array(700000);
  bad(zip([{ name: 'ember/theme.json', data: THEME }, { name: 'ember/radar.vid', data: half, deflate: true }, { name: 'ember/alert.snd', data: half, deflate: true }, { name: 'ember/emblem.bin', data: half, deflate: true }]), /too big/i,
    { ...LIMITS, totalBytes: 2000000 });
});

test('an entry pointing outside the file is refused', () => {
  const z = zip([{ name: 'ember/theme.json', data: THEME }]);
  const dv = new DataView(z.buffer);
  const cd = dv.getUint32(z.length - 22 + 16, true);
  dv.setUint32(cd + 42, 0x7fffffff, true);                     // local header offset far past the end
  bad(z, /damaged/i);
});

test('a trailing comment after the zip is tolerated only as a zip comment', () => {
  const r = readZip(zip([{ name: 'ember/theme.json', data: THEME }], { trailer: text('junk') }));
  assert.equal(r.ok, false);
});
