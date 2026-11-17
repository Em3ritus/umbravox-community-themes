#!/usr/bin/env node
// The step that holds a token that can write. It receives the checked submission as files (an artifact made by the
// read-only check job) and treats every byte as data: it validates names, types and sizes again, then copies the
// theme into themes/ and previews/. Nothing from the submission is ever executed here.
//
//   node scripts/propose.mjs stage   --in <dir> --root <dir> --issue <n> --login <name> --date <YYYY-MM-DD>
//        prints {"ok":true,"folder","name"} or {"ok":false,"error"} on stdout; exit 0 either way, 2 on bad usage
//   node scripts/propose.mjs comment --result <file> [--pr <url>]        the comment for the submission, on stdout
//   node scripts/propose.mjs pr      --result <file> --issue <n> --login <name> --repo <owner/name> --sha <commit>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACK_FILES, FOLDER_RE, themeName } from './zipread.mjs';
import { buildIndex, findClash } from './build-index.mjs';

const SITE = 'https://em3ritus.github.io/umbravox-community-themes/';
const DESIGNER = 'https://em3ritus.github.io/umbravox/designer/';
const MAX = { 'theme.json': 4096, 'emblem.bin': 9728, 'radar.vid': 780312, 'alert.snd': 576020 };
const PREVIEWS = ['cyd.png', 'waveshare.png'];
const MAX_PNG = 1 << 20;
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const no = (error) => ({ ok: false, error });
const UNEXPECTED = 'The checks produced something unexpected, so nothing was accepted. A maintainer will look at it.';

// A regular file (never a link) no bigger than max -> its bytes, else null.
function plain(p, max) {
  const s = fs.lstatSync(p, { throwIfNoEntry: false });
  return s && s.isFile() && s.size <= max ? fs.readFileSync(p) : null;
}
const only = (dir, allowed) => fs.readdirSync(dir).every((n) => allowed.includes(n));

// inDir: result.txt, submission.json, pack/<folder>/<pack files>, previews/{cyd,waveshare}.png
// -> {ok:true, folder, name} after writing root/themes/<folder>/ and root/previews/<folder>/, or {ok:false, error}.
export function stageSubmission(inDir, root, { issue, login, date }) {
  if (!Number.isInteger(issue) || issue < 1 || !/^[A-Za-z0-9-]{1,39}(\[bot\])?$/.test(String(login)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return no(UNEXPECTED);
  const resultRaw = plain(path.join(inDir, 'result.txt'), 4096);
  if (!resultRaw) return no(UNEXPECTED);
  const result = resultRaw.toString('utf8').trim();
  if (result !== 'OK') return no(result.split('\n')[0].slice(0, 500) || UNEXPECTED);

  let sub;
  try { sub = JSON.parse(plain(path.join(inDir, 'submission.json'), 4096).toString('utf8')); } catch (e) { return no(UNEXPECTED); }
  const text = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
  if (!sub || !text(sub.folder, 31) || !FOLDER_RE.test(sub.folder) || !text(sub.name, 60) || !sub.name.trim() || !text(sub.author, 60) || !text(sub.basedOn, 31)) return no(UNEXPECTED);
  if (sub.basedOn && !FOLDER_RE.test(sub.basedOn)) return no(UNEXPECTED);

  const packDir = path.join(inDir, 'pack'), src = path.join(packDir, sub.folder), prev = path.join(inDir, 'previews');
  for (const d of [packDir, src, prev]) { const s = fs.lstatSync(d, { throwIfNoEntry: false }); if (!s || !s.isDirectory()) return no(UNEXPECTED); }
  if (!only(packDir, [sub.folder]) || !only(src, PACK_FILES) || !only(prev, PREVIEWS)) return no(UNEXPECTED);
  const files = [];
  for (const n of PACK_FILES) {
    if (!fs.existsSync(path.join(src, n))) continue;
    const data = plain(path.join(src, n), MAX[n]);
    if (!data) return no(UNEXPECTED);
    files.push({ n, data });
  }
  const tj = files.find((f) => f.n === 'theme.json');
  if (!tj) return no(UNEXPECTED);
  // The name is read from theme.json here, again: the gallery lists that name, and submission.json is only a claim.
  const name = themeName(tj.data);
  if (!name) return no('The theme.json has no readable name, so the device would skip this theme.');
  const shots = [];
  for (const n of PREVIEWS) {
    const data = plain(path.join(prev, n), MAX_PNG);
    if (!data || !PNG_SIG.every((b, i) => data[i] === b)) return no(UNEXPECTED);
    shots.push({ n, data });
  }

  // The gallery must not already hold this folder or name. No exception for the same submission: this step always
  // starts from main, so a match is a theme that was already approved, and an approved theme is never replaced.
  let index;
  try { index = buildIndex(root); } catch (e) { return no(UNEXPECTED); }
  const clash = findClash(index, { folder: sub.folder, name });
  if (clash) return no(clash);

  const tdir = path.join(root, 'themes', sub.folder), pdir = path.join(root, 'previews', sub.folder);
  if (fs.existsSync(tdir) || fs.existsSync(pdir)) return no(UNEXPECTED);
  fs.mkdirSync(tdir, { recursive: true }); fs.mkdirSync(pdir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(tdir, f.n), f.data);
  for (const s of shots) fs.writeFileSync(path.join(pdir, s.n), s.data);
  fs.writeFileSync(path.join(tdir, 'meta.json'), JSON.stringify({ login, issue, added: date, author: sub.author, basedOn: sub.basedOn }) + '\n');
  return { ok: true, folder: sub.folder, name, files: files.map((f) => f.n) };
}

// Text that came from a submission, made safe to show in a comment: one line, no mentions, no markup, no address
// that a reader could click.
const quiet = (s) => String(s).replace(/\s+/g, ' ').replace(/:\/\//g, ' ').replace(/www\./gi, 'www ').replace(/[`<>*_\[\]()#|~\\]/g, '').replace(/@/g, '(at)').trim().slice(0, 400);

export function commentBody(result, { pr = '' } = {}) {
  if (!result.ok) {
    return ['This theme could not be accepted yet:', '', '> ' + quiet(result.error), '',
      'Fix it in the [designer](' + DESIGNER + '), press **Share** again to save a new zip, then edit this submission and replace the zip. The checks run again when you save the edit.'].join('\n');
  }
  return ['**' + quiet(result.name) + '** passed the checks.', '',
    'It is waiting for a maintainer' + (pr ? ' in ' + pr : '') + '. Once approved it will be in the gallery at ' + SITE + '#' + result.folder + '.', '',
    'The checks cover format only. If the theme is not approved, or is removed later, the reason will be noted here.'].join('\n');
}

// The pull request the owner reviews. Every link names the exact commit, so what is shown is what a merge publishes;
// a later edit by the submitter closes this pull request and opens a new one (see submission.yml).
export function prBody(result, { issue, login, repo, sha }) {
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error('prBody: the commit must be a full 40-character hash');
  const raw = 'https://raw.githubusercontent.com/' + repo + '/' + sha + '/previews/' + result.folder + '/';
  const tree = 'https://github.com/' + repo + '/tree/' + sha + '/themes/' + result.folder;
  const files = Array.isArray(result.files) ? result.files : [];
  const extras = [files.includes('radar.vid') ? 'a radar clip (`radar.vid`)' : '', files.includes('alert.snd') ? 'alert sounds (`alert.snd`)' : ''].filter(Boolean);
  const unseen = extras.length
    ? '**This theme includes ' + extras.join(' and ') + ', which are not shown here.** The pictures are one still frame each. To see the clip and hear the sounds before approving, download [the theme folder at this commit](' + tree + ') and open it in the [designer](' + DESIGNER + ') with "Open an existing theme".'
    : 'This theme has no radar clip and no alert sounds: the two pictures and the colours are all of it. [The theme folder at this commit](' + tree + ').';
  return ['Theme **' + quiet(result.name) + '** (`themes/' + result.folder + '/`), submitted by ' + quiet(login) + '.', '',
    '| CYD 2.8" | Waveshare 3.5" |', '| --- | --- |',
    '| ![CYD](' + raw + 'cyd.png) | ![Waveshare](' + raw + 'waveshare.png) |', '',
    unseen, '',
    'The pictures were drawn by the device\'s own drawing code and are the ones stored in commit `' + sha.slice(0, 12) + '`. The device\'s theme loader accepted the pack. Nothing checks where the picture, clip or sounds came from.', '',
    'This pull request never changes. If the submitter edits the submission, this one is closed and a new one is opened.', '',
    '**Merge to approve.** Close without merging to reject.', '',
    'Closes #' + issue].join('\n');
}

function main(argv) {
  const cmd = argv[0];
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const readResult = () => JSON.parse(fs.readFileSync(arg('--result'), 'utf8'));
  if (cmd === 'stage' && arg('--in') && arg('--root') && arg('--issue') && arg('--login') && arg('--date')) {
    let r;
    try { r = stageSubmission(arg('--in'), arg('--root'), { issue: Number(arg('--issue')), login: arg('--login'), date: arg('--date') }); }
    catch (e) { r = no(UNEXPECTED); }
    process.stdout.write(JSON.stringify(r) + '\n');
    return 0;
  }
  if (cmd === 'comment' && arg('--result')) { process.stdout.write(commentBody(readResult(), { pr: arg('--pr') || '' }) + '\n'); return 0; }
  if (cmd === 'pr' && arg('--result') && arg('--issue') && arg('--login') && arg('--repo') && arg('--sha')) {
    process.stdout.write(prBody(readResult(), { issue: Number(arg('--issue')), login: arg('--login'), repo: arg('--repo'), sha: arg('--sha') }) + '\n');
    return 0;
  }
  process.stderr.write('usage: node scripts/propose.mjs stage|comment|pr ... (see the top of the file)\n');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
