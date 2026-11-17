#!/usr/bin/env node
// A theme submission: read the issue form's text, then unpack the attached zip into a folder.
//
//   node scripts/intake.mjs --body <file> --zip <file> --out <dir>
//   node scripts/intake.mjs --body <file> --url        print the attached zip's address (or the refusal, exit 1)
//
// On success writes <dir>/<folder>/<pack files> and <dir>/submission.json, exit 0.
// On a refusal prints ONE plain line on stdout (it becomes the comment on the submission), writes nothing, exit 1.
// Exit 2 is a usage error. Everything read here was written by a stranger: it is data, never run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, FOLDER_RE } from './zipread.mjs';

const ATTACHMENT = /https?:\/\/[^\s)\]>"']*\.zip\b[^\s)\]>"']*/gi;
const GITHUB_ZIP = /^https:\/\/github\.com\/user-attachments\/files\/\d+\/[A-Za-z0-9._-]+\.zip$/;
const HEADINGS = ['Theme name', 'Author credit', 'Based on', 'Theme zip', 'Agreement'];

// One short line of text from a form field.
const line = (s) => String(s).split('\n')[0].replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60).trim();
const no = (error) => ({ ok: false, error });

// The issue form's body is "### Heading\n\nvalue" blocks; an empty optional field reads "_No response_".
// -> {ok:true, name, author, basedOn, zipUrl} | {ok:false, error}
export function parseSubmission(body) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n');
  const fields = {};
  const parts = text.split(/^### +(.+?) *$/m);                 // [before, heading, value, heading, value, ...]
  for (let i = 1; i + 1 < parts.length; i += 2) if (!(parts[i] in fields)) fields[parts[i]] = parts[i + 1].trim();
  for (const h of HEADINGS) if (!(h in fields)) return no('This does not look like the theme submission form (the "' + h + '" field is missing). Please use the Share button in the designer.');
  const val = (h) => (fields[h] === '_No response_' ? '' : fields[h]);

  const name = line(val('Theme name'));
  if (!name) return no('The theme name is empty.');
  const author = line(val('Author credit'));
  const basedOn = line(val('Based on'));
  if (basedOn && !FOLDER_RE.test(basedOn)) return no('The "Based on" field must be the folder name of a gallery theme (letters, digits, - and _), or empty.');

  const boxes = fields['Agreement'].split('\n').filter((l) => /^\s*- \[[ xX]\]/.test(l));
  if (boxes.length < 2 || !boxes.every((l) => /^\s*- \[[xX]\]/.test(l))) return no('Both boxes in the form must be ticked before a theme can be accepted.');

  const links = text.match(ATTACHMENT) || [];
  if (links.length !== 1) return no('The form must hold exactly one zip: drag the theme zip the designer saved into the "Theme zip" field. Found ' + links.length + '.');
  if (!GITHUB_ZIP.test(links[0]) || !val('Theme zip').includes(links[0])) return no('The theme zip must be dragged into the "Theme zip" field of the form, not linked from somewhere else.');
  return { ok: true, name, author, basedOn, zipUrl: links[0] };
}

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const bodyFile = arg('--body'), zipFile = arg('--zip'), out = arg('--out');
  if (bodyFile && argv.includes('--url')) {                    // only the form: print the zip's address for the download step
    const sub = parseSubmission(fs.readFileSync(bodyFile, 'utf8'));
    process.stdout.write((sub.ok ? sub.zipUrl : String(sub.error).replace(/\s+/g, ' ').trim()) + '\n');
    return sub.ok ? 0 : 1;
  }
  if (!bodyFile || !zipFile || !out) { process.stderr.write('usage: node scripts/intake.mjs --body <file> --zip <file> --out <dir>\n'); return 2; }
  const refuse = (msg) => { process.stdout.write(String(msg).replace(/\s+/g, ' ').trim() + '\n'); return 1; };

  const sub = parseSubmission(fs.readFileSync(bodyFile, 'utf8'));
  if (!sub.ok) return refuse(sub.error);
  const z = readZip(new Uint8Array(fs.readFileSync(zipFile)));
  if (!z.ok) return refuse(z.error);

  // z.folder passed FOLDER_RE and every name is one of the four pack files, so these joins cannot leave `out`.
  const dir = path.join(out, z.folder);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of z.files) fs.writeFileSync(path.join(dir, f.name), f.data, { flag: 'wx' });
  fs.writeFileSync(path.join(out, 'submission.json'), JSON.stringify({ folder: z.folder, name: sub.name, author: sub.author, basedOn: sub.basedOn }) + '\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
