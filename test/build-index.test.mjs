// The gallery's index.json, built from the themes folder; and the check that a new theme does not reuse a name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildIndex, findClash } from '../scripts/build-index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function repo(themes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uvt-index-'));
  fs.mkdirSync(path.join(root, 'themes'));
  for (const [folder, t] of Object.entries(themes)) {
    const d = path.join(root, 'themes', folder);
    fs.mkdirSync(d);
    if (t.json !== null) fs.writeFileSync(path.join(d, 'theme.json'), t.json ?? JSON.stringify({ format: 1, name: t.name }));
    for (const f of t.files || []) fs.writeFileSync(path.join(d, f), 'x');
    if (t.meta !== null) fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify(t.meta ?? { login: 'someone', issue: 7, added: '2026-11-17', author: 'Some One', basedOn: '' }));
  }
  return root;
}
const cli = (...args) => spawnSync('node', ['scripts/build-index.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });

test('two themes give two entries, newest first, listing only the pack files', () => {
  const root = repo({
    ember: { name: 'EMBER', files: ['emblem.bin', 'notes.txt'] },
    'cosmic-two': { name: 'COSMIC TWO', files: ['radar.vid', 'alert.snd'], meta: { login: 'x', issue: 9, added: '2026-12-01', author: '', basedOn: 'ember' } },
  });
  assert.deepEqual(buildIndex(root), { version: 1, themes: [
    { folder: 'cosmic-two', name: 'COSMIC TWO', author: '', basedOn: 'ember', format: 1, files: ['theme.json', 'radar.vid', 'alert.snd'], login: 'x', issue: 9, added: '2026-12-01' },
    { folder: 'ember', name: 'EMBER', author: 'Some One', basedOn: '', format: 1, files: ['theme.json', 'emblem.bin'], login: 'someone', issue: 7, added: '2026-11-17' },
  ] });
});

test('the same date sorts by folder name, and no themes folder is an empty index', () => {
  const root = repo({ b: { name: 'B' }, a: { name: 'A' } });
  assert.deepEqual(buildIndex(root).themes.map((t) => t.folder), ['a', 'b']);
  assert.deepEqual(buildIndex(fs.mkdtempSync(path.join(os.tmpdir(), 'uvt-empty-'))), { version: 1, themes: [] });
});

test('a broken theme folder stops the build and names the folder', () => {
  for (const [what, t] of [['no meta.json', { name: 'X', meta: null }], ['no theme.json', { json: null }], ['bad theme.json', { json: '{not json' }], ['no name', { json: '{"format":1}' }], ['bad date', { name: 'X', meta: { login: 'a', issue: 1, added: 'yesterday', author: '', basedOn: '' } }]]) {
    assert.throws(() => buildIndex(repo({ broken: t })), /broken/, what);
  }
  assert.throws(() => buildIndex(repo({ 'bad name': { name: 'X' } })), /bad name/);
});

test('findClash: folder and name are compared without case, and built-in names are taken', () => {
  const index = { version: 1, themes: [{ folder: 'ember', name: 'Midnight Ember' }] };
  assert.match(findClash(index, { folder: 'EMBER', name: 'NEW' }), /folder/);
  assert.match(findClash(index, { folder: 'new', name: 'MIDNIGHT  EMBER ' }), /already has a theme called/);
  for (const n of ['UMBRAVOX', 'baph0mau5', 'Cvlt of Baph0mau5', 'COSMIC MUFFIN']) assert.match(findClash(index, { folder: 'new', name: n }), /built-in/);
  assert.equal(findClash(index, { folder: 'new', name: 'NEW' }), null);
  assert.equal(findClash({ version: 1, themes: [] }, { folder: 'ember', name: 'EMBER' }), null);
});

test('the command writes index.json, and reports a clash with one line', () => {
  const root = repo({ ember: { name: 'EMBER' } });
  const out = path.join(root, 'index.json');
  const r = cli(root, '--out', out);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).themes[0].folder, 'ember');
  const clash = cli(root, '--clash', 'ember2', 'ember');
  assert.equal(clash.status, 1);
  assert.equal(clash.stdout.trim().split('\n').length, 1);
  assert.equal(cli(root, '--clash', 'fresh', 'FRESH').status, 0);
  const broken = cli(repo({ broken: { name: 'X', meta: null } }), '--out', out);
  assert.equal(broken.status, 1); assert.match(broken.stderr, /broken/);
  assert.equal(cli().status, 2);
});
