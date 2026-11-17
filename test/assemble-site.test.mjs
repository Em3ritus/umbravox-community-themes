// The published site: the gallery page, the themes' pack files, the previews and a fresh index.json. Never meta.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assembleSite } from '../scripts/assemble-site.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uvt-site-'));
  fs.cpSync(path.join(ROOT, 'site'), path.join(root, 'site'), { recursive: true });
  fs.mkdirSync(path.join(root, 'themes/ember'), { recursive: true });
  fs.mkdirSync(path.join(root, 'previews/ember'), { recursive: true });
  fs.mkdirSync(path.join(root, 'previews/orphan'), { recursive: true });
  fs.writeFileSync(path.join(root, 'themes/ember/theme.json'), '{"format":1,"name":"EMBER"}');
  fs.writeFileSync(path.join(root, 'themes/ember/emblem.bin'), 'xx');
  fs.writeFileSync(path.join(root, 'themes/ember/notes.txt'), 'private');
  fs.writeFileSync(path.join(root, 'themes/ember/meta.json'), JSON.stringify({ login: 'a', issue: 1, added: '2026-11-17', author: '', basedOn: '' }));
  for (const n of ['cyd.png', 'waveshare.png']) fs.writeFileSync(path.join(root, 'previews/ember', n), 'png');
  fs.writeFileSync(path.join(root, 'previews/orphan/cyd.png'), 'png');
  return root;
}
const list = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name))])).sort();

test('the site holds the page, the index, the pack files and the previews of listed themes only', () => {
  const root = repo(), out = path.join(root, '_site');
  const index = assembleSite(root, out);
  assert.equal(index.themes.length, 1);
  assert.deepEqual(list(out), ['gallery.css', 'gallery.js', 'index.html', 'index.json', 'previews/ember/cyd.png', 'previews/ember/waveshare.png', 'themes/ember/emblem.bin', 'themes/ember/theme.json', 'zip.js']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')).themes[0].files, ['theme.json', 'emblem.bin']);
});

test('an empty repository still publishes the page with an empty index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uvt-site-'));
  fs.cpSync(path.join(ROOT, 'site'), path.join(root, 'site'), { recursive: true });
  const out = path.join(root, '_site');
  assert.deepEqual(assembleSite(root, out), { version: 1, themes: [] });
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
});

test('a theme with a missing preview stops the build', () => {
  const root = repo();
  fs.rmSync(path.join(root, 'previews/ember/waveshare.png'));
  assert.throws(() => assembleSite(root, path.join(root, '_site')), /ember.*waveshare\.png/);
});

test('the command line', () => {
  const root = repo();
  const r = spawnSync('node', ['scripts/assemble-site.mjs', root, path.join(root, '_site')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(spawnSync('node', ['scripts/assemble-site.mjs'], { cwd: ROOT, encoding: 'utf8' }).status, 2);
});
