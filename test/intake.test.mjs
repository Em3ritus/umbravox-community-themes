// Reading a submission: the issue form's text, and the command-line step that unpacks the zip into a folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSubmission } from '../scripts/intake.mjs';
import { zip, THEME } from './_zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL1 = 'https://github.com/user-attachments/files/123456/ember.zip';
const body = (o = {}) => [
  '### Theme name', '', o.name ?? 'EMBER', '',
  '### Author credit', '', o.author ?? 'someone', '',
  '### Based on', '', o.basedOn ?? '_No response_', '',
  '### Theme zip', '', o.zip ?? '[ember.zip](' + URL1 + ')', '',
  '### Agreement', '', o.boxes ?? '- [x] I made everything in this theme, or I have the right to share it publicly.\n- [X] I have read the content rules and agree this theme may be removed at any time.', '',
].join('\n');

test('a well-formed submission', () => {
  assert.deepEqual(parseSubmission(body()), { ok: true, name: 'EMBER', author: 'someone', basedOn: '', zipUrl: URL1 });
});

test('Windows line endings and a bare link are read the same', () => {
  const r = parseSubmission(body({ zip: URL1 }).replace(/\n/g, '\r\n'));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.zipUrl, URL1);
});

test('based on is optional, and must be a folder name when given', () => {
  assert.equal(parseSubmission(body({ basedOn: 'cosmic-two' })).basedOn, 'cosmic-two');
  const r = parseSubmission(body({ basedOn: '../x y' }));
  assert.equal(r.ok, false); assert.match(r.error, /Based on/);
});

test('an empty author is allowed', () => {
  assert.equal(parseSubmission(body({ author: '_No response_' })).author, '');
});

test('both boxes must be ticked', () => {
  for (const boxes of ['- [ ] a\n- [x] b', '- [x] a\n- [ ] b', '- [x] a', '']) {
    const r = parseSubmission(body({ boxes }));
    assert.equal(r.ok, false, JSON.stringify(boxes)); assert.match(r.error, /tick/i);
  }
});

test('exactly one zip attachment, and only a GitHub attachment', () => {
  const two = parseSubmission(body({ zip: URL1 + '\nhttps://github.com/user-attachments/files/9/b.zip' }));
  assert.equal(two.ok, false); assert.match(two.error, /one zip/i);
  for (const zipText of ['_No response_', 'https://example.com/a.zip', 'https://github.com/user-attachments/files/12/a.zip/extra.zip', 'https://github.com/user-attachments/files/12/a.tar', 'https://github.com/user-attachments/assets/12/a.zip', 'http://github.com/user-attachments/files/12/a.zip', 'https://github.com.evil.example/user-attachments/files/12/a.zip']) {
    const r = parseSubmission(body({ zip: zipText }));
    assert.equal(r.ok, false, zipText); assert.match(r.error, /zip/i);
  }
});

test('a second attachment link hidden in another field is counted too', () => {
  const r = parseSubmission(body({ author: 'x https://github.com/user-attachments/files/9/b.zip' }));
  assert.equal(r.ok, false); assert.match(r.error, /one zip/i);
});

test('a missing heading or an empty name is refused', () => {
  assert.equal(parseSubmission('just some text').ok, false);
  assert.equal(parseSubmission('').ok, false);
  assert.equal(parseSubmission(null).ok, false);
  assert.equal(parseSubmission(body({ name: '_No response_' })).ok, false);
});

test('long or multi-line fields are cut to one short line', () => {
  const r = parseSubmission(body({ author: 'a'.repeat(300) + '\nsecond line' }));
  assert.equal(r.ok, true, r.error);
  assert.ok(r.author.length <= 60);
  assert.equal(/\n/.test(r.author), false);
});

// ---- the command line ----
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'uvt-intake-'));
function run(bodyText, zipBytes) {
  const d = tmp(), out = path.join(d, 'out');
  fs.writeFileSync(path.join(d, 'body.md'), bodyText);
  fs.writeFileSync(path.join(d, 'in.zip'), zipBytes);
  const r = spawnSync('node', ['scripts/intake.mjs', '--body', path.join(d, 'body.md'), '--zip', path.join(d, 'in.zip'), '--out', out], { cwd: ROOT, encoding: 'utf8' });
  return { r, out };
}

test('the command unpacks the theme and writes submission.json', () => {
  const { r, out } = run(body({ basedOn: 'cosmic-two' }), zip([{ name: 'ember/theme.json', data: THEME }, { name: 'ember/emblem.bin', data: new Uint8Array([9, 9]) }]));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fs.readdirSync(out).sort(), ['ember', 'submission.json']);
  assert.deepEqual(fs.readdirSync(path.join(out, 'ember')).sort(), ['emblem.bin', 'theme.json']);
  assert.deepEqual([...fs.readFileSync(path.join(out, 'ember', 'theme.json'))], [...THEME]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'submission.json'), 'utf8')), { folder: 'ember', name: 'EMBER', author: 'someone', basedOn: 'cosmic-two' });
});

test('the command refuses a bad zip with one plain line and writes nothing', () => {
  const { r, out } = run(body(), zip([{ name: '../theme.json', data: THEME }]));
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.ok(r.stdout.trim().length > 10);
  assert.equal(fs.existsSync(out), false);
});

test('the command refuses a bad form before looking at the zip', () => {
  const { r, out } = run(body({ boxes: '- [ ] a\n- [ ] b' }), zip([{ name: 'ember/theme.json', data: THEME }]));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /tick/i);
  assert.equal(fs.existsSync(out), false);
});

test('the command with missing arguments prints its usage', () => {
  const r = spawnSync('node', ['scripts/intake.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--body <file> --zip <file> --out <dir>/);
});
