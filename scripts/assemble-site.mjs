#!/usr/bin/env node
// Build the published site: the gallery page, a fresh index.json, and for each listed theme its pack files and its
// two preview pictures. meta.json and anything else in a theme folder stay out.
//
//   node scripts/assemble-site.mjs <root> <out>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from './build-index.mjs';

const PREVIEWS = ['cyd.png', 'waveshare.png'];

export function assembleSite(root, out) {
  const index = buildIndex(root);
  for (const t of index.themes) {
    for (const n of PREVIEWS) if (!fs.existsSync(path.join(root, 'previews', t.folder, n))) throw new Error('themes/' + t.folder + ' has no previews/' + t.folder + '/' + n);
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const e of fs.readdirSync(path.join(root, 'site'), { withFileTypes: true })) {
    if (e.isFile()) fs.copyFileSync(path.join(root, 'site', e.name), path.join(out, e.name));
  }
  for (const t of index.themes) {
    fs.mkdirSync(path.join(out, 'themes', t.folder), { recursive: true });
    fs.mkdirSync(path.join(out, 'previews', t.folder), { recursive: true });
    for (const n of t.files) fs.copyFileSync(path.join(root, 'themes', t.folder, n), path.join(out, 'themes', t.folder, n));
    for (const n of PREVIEWS) fs.copyFileSync(path.join(root, 'previews', t.folder, n), path.join(out, 'previews', t.folder, n));
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  return index;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, out] = process.argv.slice(2);
  if (!root || !out) { process.stderr.write('usage: node scripts/assemble-site.mjs <root> <out>\n'); process.exit(2); }
  try { const i = assembleSite(root, out); process.stdout.write('site assembled in ' + out + ': ' + i.themes.length + ' theme(s)\n'); }
  catch (e) { process.stderr.write('assemble-site: ' + e.message + '\n'); process.exit(1); }
}
