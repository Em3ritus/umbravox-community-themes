#!/usr/bin/env node
// The gallery's list of themes, built from themes/<folder>/ (the pack files plus meta.json).
//
//   node scripts/build-index.mjs <root> --out <file>             write index.json
//   node scripts/build-index.mjs <root> --clash <folder> <name>  exit 1 and one line if the gallery already has it
//
// index.json: { version: 1, themes: [ { folder, name, author, basedOn, format, files, login, issue, added } ] },
// newest first. The designer reads the same file to open a theme (web/designer/js/gallery.js in the firmware repository).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_FILES, FOLDER_RE } from './zipread.mjs';

export const BUILT_IN = ['UMBRAVOX', 'BAPH0MAU5', 'CVLT OF BAPH0MAU5', 'COSMIC MUFFIN'];
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

export function buildIndex(root) {
  const dir = path.join(root, 'themes');
  const themes = [];
  const folders = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
  for (const folder of folders) {
    const bad = (why) => new Error('themes/' + folder + ': ' + why);
    if (!FOLDER_RE.test(folder)) throw bad('the folder name is not allowed');
    const read = (n) => {
      const p = path.join(dir, folder, n);
      if (!fs.existsSync(p)) throw bad('no ' + n);
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw bad(n + ' is not valid JSON'); }
    };
    const theme = read('theme.json'), meta = read('meta.json');
    if (typeof theme.name !== 'string' || !theme.name.trim()) throw bad('theme.json has no name');
    if (typeof meta.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(meta.added)) throw bad('meta.json "added" is not a YYYY-MM-DD date');
    themes.push({
      folder, name: theme.name, author: str(meta.author, 60), basedOn: FOLDER_RE.test(str(meta.basedOn, 31)) ? meta.basedOn : '',
      format: Number.isInteger(theme.format) ? theme.format : 1,
      files: PACK_FILES.filter((n) => fs.existsSync(path.join(dir, folder, n))),
      login: str(meta.login, 40), issue: Number.isInteger(meta.issue) ? meta.issue : 0, added: meta.added,
    });
  }
  themes.sort((a, b) => (a.added === b.added ? (a.folder < b.folder ? -1 : 1) : a.added < b.added ? 1 : -1));
  return { version: 1, themes };
}

// -> a plain sentence saying what clashes, or null.
export function findClash(index, { folder, name }) {
  if (BUILT_IN.includes(norm(name))) return 'The name ' + norm(name) + ' belongs to a built-in theme. Give the theme another name.';
  for (const t of index.themes) {
    if (String(t.folder).toLowerCase() === String(folder).toLowerCase()) return 'The gallery already has a theme in the folder ' + t.folder + '. Rename the theme in the designer and share it again.';
    if (norm(t.name) === norm(name)) return 'The gallery already has a theme called ' + t.name + '. Rename the theme in the designer and share it again.';
  }
  return null;
}

function main(argv) {
  const root = argv[0], mode = argv[1];
  try {
    if (root && mode === '--out' && argv[2]) { fs.writeFileSync(argv[2], JSON.stringify(buildIndex(root), null, 1) + '\n'); return 0; }
    if (root && mode === '--clash' && argv[2] && argv[3]) {
      const c = findClash(buildIndex(root), { folder: argv[2], name: argv[3] });
      if (c) { process.stdout.write(c + '\n'); return 1; }
      return 0;
    }
  } catch (e) { process.stderr.write('build-index: ' + e.message + '\n'); return 1; }
  process.stderr.write('usage: node scripts/build-index.mjs <root> --out <file> | <root> --clash <folder> <name>\n');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
