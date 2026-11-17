// The gallery page: each theme's card, built as text so it can be tested without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardHtml, escapeHtml, DESIGNER, REPO } from '../site/gallery.js';
import { makeZip } from '../site/zip.js';
import { readZip } from '../scripts/zipread.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = (o = {}) => ({ folder: 'ember', name: 'EMBER', author: 'Some One', basedOn: '', format: 1, files: ['theme.json', 'emblem.bin'], login: 'someone', issue: 7, added: '2026-11-17', ...o });

test('where the designer and the repository are', () => {
  assert.equal(DESIGNER, 'https://em3ritus.github.io/umbravox/designer/');
  assert.equal(REPO, 'Em3ritus/umbravox-themes');
});

test('text from a submission is escaped', () => {
  assert.equal(escapeHtml('<b>"A" & \'B\'</b>'), '&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;');
  const html = cardHtml(entry({ name: '<b>X</b>', author: 'A"B<script>' }));
  assert.equal(html.includes('<b>X</b>'), false);
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.ok(html.includes('A&quot;B&lt;script&gt;'));
});

test('a card links to the designer, both pictures, the zip and the report form', () => {
  const html = cardHtml(entry());
  assert.ok(html.includes('href="https://em3ritus.github.io/umbravox/designer/?theme=ember"'));
  assert.ok(html.includes('src="previews/ember/cyd.png"'));
  assert.ok(html.includes('src="previews/ember/waveshare.png"'));
  assert.equal((html.match(/loading="lazy"/g) || []).length, 2);
  assert.equal((html.match(/ alt="[^"]{8,}"/g) || []).length, 2);
  assert.match(html, /width="480" height="360"/); assert.match(html, /width="480" height="320"/);
  assert.ok(html.includes('data-zip="ember"'));
  assert.ok(html.includes('href="https://github.com/Em3ritus/umbravox-themes/issues/new?template=report-theme.yml&amp;theme=ember"'));
  assert.ok(html.includes('Open in designer')); assert.ok(html.includes('Download zip')); assert.ok(html.includes('Report'));
});

test('author and based-on show only when set', () => {
  assert.ok(cardHtml(entry()).includes('by Some One'));
  assert.equal(cardHtml(entry({ author: '' })).includes('by '), false);
  assert.equal(cardHtml(entry()).includes('Based on'), false);
  const b = cardHtml(entry({ basedOn: 'cosmic-two' }));
  assert.ok(b.includes('Based on')); assert.ok(b.includes('href="#cosmic-two"'));
  assert.equal(cardHtml(entry({ basedOn: '../x' })).includes('Based on'), false);
});

test('an entry with a folder name that is not allowed makes no card', () => {
  for (const folder of ['../x', 'a b', '', 'a"b']) assert.equal(cardHtml(entry({ folder })), '');
});

test('the page: viewport, the content notice, nothing loaded from another host', () => {
  const html = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.ok(html.includes('Themes are made by other people and are checked for format only.'));
  assert.match(html, /<main id="cards"/);
  assert.match(html, /<title>[^<]+<\/title>/);
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^https?:/.test(m[1])) assert.match(m[1], /^https:\/\/(github\.com\/Em3ritus\/|em3ritus\.github\.io\/)/, m[1]);
  }
  assert.equal(/<script(?![^>]*\ssrc="gallery\.js")[^>]*>/.test(html), false, 'only gallery.js, no inline script');
  const css = fs.readFileSync(path.join(ROOT, 'site/gallery.css'), 'utf8');
  assert.match(css, /prefers-color-scheme: dark/);
  assert.equal(/url\(|@import/.test(css), false);
});

test('the browser-side zip is one the submission reader accepts', () => {
  const data = new TextEncoder().encode('{"format":1,"name":"EMBER"}');
  const r = readZip(makeZip([{ path: 'ember/theme.json', data }, { path: 'ember/emblem.bin', data: new Uint8Array([1, 2]) }]));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.folder, 'ember');
});
