// The step that has write access: it takes the checked submission (an artifact from the read-only job), trusts
// nothing in it, and stages the theme into the repository. Also the comment and pull request text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageSubmission, commentBody, prBody } from '../scripts/propose.mjs';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
// A checked submission as the check job uploads it.
function artifact(o = {}) {
  const d = tmp('uvt-art-');
  fs.writeFileSync(path.join(d, 'result.txt'), o.result ?? 'OK\n');
  const sub = o.sub ?? { folder: 'ember', name: 'EMBER', author: 'Some One', basedOn: '' };
  if (o.sub !== null) fs.writeFileSync(path.join(d, 'submission.json'), typeof sub === 'string' ? sub : JSON.stringify(sub));
  const folder = o.folderOnDisk ?? 'ember';
  fs.mkdirSync(path.join(d, folder), { recursive: true });
  for (const [n, data] of Object.entries(o.files ?? { 'theme.json': '{"format":1,"name":"EMBER"}', 'emblem.bin': 'xx' })) fs.writeFileSync(path.join(d, folder, n), data);
  fs.mkdirSync(path.join(d, 'previews'));
  for (const [n, data] of Object.entries(o.previews ?? { 'cyd.png': PNG, 'waveshare.png': PNG })) fs.writeFileSync(path.join(d, 'previews', n), data);
  return d;
}
const ctx = { issue: 12, login: 'someone', date: '2026-11-17' };

test('a checked submission is staged: pack files, meta.json and both previews', () => {
  const root = tmp('uvt-root-');
  const r = stageSubmission(artifact(), root, ctx);
  assert.deepEqual(r, { ok: true, folder: 'ember', name: 'EMBER' });
  assert.deepEqual(fs.readdirSync(path.join(root, 'themes/ember')).sort(), ['emblem.bin', 'meta.json', 'theme.json']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'previews/ember')).sort(), ['cyd.png', 'waveshare.png']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'themes/ember/meta.json'), 'utf8')), { login: 'someone', issue: 12, added: '2026-11-17', author: 'Some One', basedOn: '' });
});

test('a refused submission stages nothing and carries the reason', () => {
  const root = tmp('uvt-root-');
  const r = stageSubmission(artifact({ result: 'The zip has no theme.json, so it is not a theme.\n' }), root, ctx);
  assert.deepEqual(r, { ok: false, error: 'The zip has no theme.json, so it is not a theme.' });
  assert.deepEqual(fs.readdirSync(root), []);
});

test('anything unexpected in the artifact is refused, and nothing is written', () => {
  const cases = {
    'a folder name that is not allowed': { sub: { folder: '../x', name: 'X', author: '', basedOn: '' } },
    'submission.json that is not JSON': { sub: '{nope' },
    'no submission.json': { sub: null },
    'a name that is not text': { sub: { folder: 'ember', name: 7, author: '', basedOn: '' } },
    'a file that is not a pack file': { files: { 'theme.json': '{}', 'run.sh': 'x' } },
    'no theme.json': { files: { 'emblem.bin': 'x' } },
    'an oversized pack file': { files: { 'theme.json': 'x'.repeat(5000) } },
    'a preview that is not a PNG': { previews: { 'cyd.png': 'GIF89a', 'waveshare.png': PNG } },
    'a missing preview': { previews: { 'cyd.png': PNG } },
    'an extra preview file': { previews: { 'cyd.png': PNG, 'waveshare.png': PNG, 'x.html': '<script>' } },
    'a folder on disk that differs from submission.json': { folderOnDisk: 'other' },
  };
  for (const [what, o] of Object.entries(cases)) {
    const root = tmp('uvt-root-');
    const r = stageSubmission(artifact(o), root, ctx);
    assert.equal(r.ok, false, what);
    assert.deepEqual(fs.readdirSync(root), [], what);
  }
});

test('a symbolic link in the artifact is refused', () => {
  const d = artifact(), root = tmp('uvt-root-');
  fs.rmSync(path.join(d, 'ember/emblem.bin'));
  fs.symlinkSync('/etc/hostname', path.join(d, 'ember/emblem.bin'));
  assert.equal(stageSubmission(d, root, ctx).ok, false);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('a theme the gallery already has is refused at this step too', () => {
  const root = tmp('uvt-root-');
  assert.equal(stageSubmission(artifact(), root, ctx).ok, true);
  const again = stageSubmission(artifact({ sub: { folder: 'ember', name: 'EMBER', author: '', basedOn: '' } }), root, { ...ctx, issue: 13 });
  assert.equal(again.ok, false); assert.match(again.error, /already has/);
});

test('the same submission edited and re-checked replaces its own earlier staging', () => {
  const root = tmp('uvt-root-');
  assert.equal(stageSubmission(artifact(), root, ctx).ok, true);
  const r = stageSubmission(artifact({ files: { 'theme.json': '{"format":1,"name":"EMBER"}' } }), root, ctx);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(fs.readdirSync(path.join(root, 'themes/ember')).sort(), ['meta.json', 'theme.json']);
});

test('bad context values are refused', () => {
  for (const c of [{ ...ctx, issue: 0 }, { ...ctx, login: 'a b' }, { ...ctx, login: '' }, { ...ctx, date: '17/11/2026' }]) {
    assert.equal(stageSubmission(artifact(), tmp('uvt-root-'), c).ok, false, JSON.stringify(c));
  }
});

test('the comment for a refusal is plain, and cannot mention anyone or break out of its quote', () => {
  const b = commentBody({ ok: false, error: 'bad @everyone `x` <img src=x> \n# heading' });
  assert.match(b, /could not be accepted/);
  assert.equal(/@everyone/.test(b), false);
  assert.equal(/<img/.test(b), false);
  assert.equal(b.split('\n').some((l) => l.startsWith('# ')), false);
  assert.match(b, /Share/);
});

test('the comment for an accepted submission links the pull request and the future gallery address', () => {
  const b = commentBody({ ok: true, folder: 'ember', name: 'EMBER' }, { pr: 'https://github.com/Em3ritus/umbravox-themes/pull/5' });
  assert.match(b, /passed the checks/);
  assert.ok(b.includes('https://github.com/Em3ritus/umbravox-themes/pull/5'));
  assert.ok(b.includes('https://em3ritus.github.io/umbravox-themes/#ember'));
  assert.match(b, /approved/);
});

test('the pull request text shows both pictures from its branch and closes the submission', () => {
  const b = prBody({ folder: 'ember', name: 'EM`BER @x' }, { issue: 12, login: 'someone', repo: 'Em3ritus/umbravox-themes', branch: 'submit/12' });
  assert.ok(b.includes('Closes #12'));
  assert.ok(b.includes('https://raw.githubusercontent.com/Em3ritus/umbravox-themes/submit/12/previews/ember/cyd.png'));
  assert.ok(b.includes('https://raw.githubusercontent.com/Em3ritus/umbravox-themes/submit/12/previews/ember/waveshare.png'));
  assert.equal(/@x/.test(b), false);
  assert.match(b, /Merge to approve/);
});
