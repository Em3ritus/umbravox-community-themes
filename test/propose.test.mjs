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
  fs.mkdirSync(path.join(d, 'pack', folder), { recursive: true });
  for (const [n, data] of Object.entries(o.files ?? { 'theme.json': '{"format":1,"name":"EMBER"}', 'emblem.bin': 'xx' })) fs.writeFileSync(path.join(d, 'pack', folder, n), data);
  if (o.extraPackDir) fs.mkdirSync(path.join(d, 'pack', o.extraPackDir));
  fs.mkdirSync(path.join(d, 'previews'));
  for (const [n, data] of Object.entries(o.previews ?? { 'cyd.png': PNG, 'waveshare.png': PNG })) fs.writeFileSync(path.join(d, 'previews', n), data);
  return d;
}
const ctx = { issue: 12, login: 'someone', date: '2026-11-17' };

test('a checked submission is staged: pack files, meta.json and both previews', () => {
  const root = tmp('uvt-root-');
  const r = stageSubmission(artifact(), root, ctx);
  assert.deepEqual(r, { ok: true, folder: 'ember', name: 'EMBER', files: ['theme.json', 'emblem.bin'] });
  assert.deepEqual(fs.readdirSync(path.join(root, 'themes/ember')).sort(), ['emblem.bin', 'meta.json', 'theme.json']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'previews/ember')).sort(), ['cyd.png', 'waveshare.png']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'themes/ember/meta.json'), 'utf8')), { login: 'someone', issue: 12, added: '2026-11-17', author: 'Some One', basedOn: '' });
});

test('a theme whose folder is called previews or pack is staged like any other', () => {
  for (const f of ['previews', 'pack', 'themes']) {
    const root = tmp('uvt-root-');
    const r = stageSubmission(artifact({ sub: { folder: f, name: 'X', author: '', basedOn: '' }, folderOnDisk: f }), root, ctx);
    assert.equal(r.ok, true, f + ': ' + r.error);
    assert.deepEqual(fs.readdirSync(path.join(root, 'themes', f)).sort(), ['emblem.bin', 'meta.json', 'theme.json']);
  }
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
    'a second folder beside the pack': { extraPackDir: 'second' },
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
  fs.rmSync(path.join(d, 'pack/ember/emblem.bin'));
  fs.symlinkSync('/etc/hostname', path.join(d, 'pack/ember/emblem.bin'));
  assert.equal(stageSubmission(d, root, ctx).ok, false);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('a theme the gallery already has is refused at this step too', () => {
  const root = tmp('uvt-root-');
  assert.equal(stageSubmission(artifact(), root, ctx).ok, true);
  const again = stageSubmission(artifact({ sub: { folder: 'ember', name: 'EMBER', author: '', basedOn: '' } }), root, { ...ctx, issue: 13 });
  assert.equal(again.ok, false); assert.match(again.error, /already has/);
});

test('a submission already in the gallery cannot be staged over itself, even from the same issue', () => {
  const root = tmp('uvt-root-');
  assert.equal(stageSubmission(artifact(), root, ctx).ok, true);
  const before = fs.readFileSync(path.join(root, 'themes/ember/emblem.bin'), 'utf8');
  const r = stageSubmission(artifact({ files: { 'theme.json': '{"format":1,"name":"EMBER"}', 'emblem.bin': 'CHANGED' } }), root, ctx);
  assert.equal(r.ok, false); assert.match(r.error, /already has/);
  assert.equal(fs.readFileSync(path.join(root, 'themes/ember/emblem.bin'), 'utf8'), before);
});

test('the name is the one inside theme.json, whatever the form said', () => {
  const root = tmp('uvt-root-');
  assert.equal(stageSubmission(artifact(), root, ctx).ok, true);                                  // the gallery now has EMBER
  const sneaky = artifact({ sub: { folder: 'fresh', name: 'TOTALLY NEW', author: '', basedOn: '' }, folderOnDisk: 'fresh' });
  const r = stageSubmission(sneaky, root, { ...ctx, issue: 13 });
  assert.equal(r.ok, false, 'theme.json says EMBER, which the gallery has');
  assert.match(r.error, /already has a theme called EMBER/);
  const ok = stageSubmission(artifact({ sub: { folder: 'other', name: 'FORM NAME', author: '', basedOn: '' }, folderOnDisk: 'other', files: { 'theme.json': '{"format":1,"name":"REAL NAME"}' } }), root, { ...ctx, issue: 14 });
  assert.deepEqual(ok, { ok: true, folder: 'other', name: 'REAL NAME', files: ['theme.json'] });
});

test('a theme.json with no readable name is refused', () => {
  for (const tj of ['{nope', '{"format":1}', '{"name":7}', '{"name":"  "}', '[]']) {
    const root = tmp('uvt-root-');
    assert.equal(stageSubmission(artifact({ files: { 'theme.json': tj } }), root, ctx).ok, false, tj);
    assert.deepEqual(fs.readdirSync(root), []);
  }
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
  const link = commentBody({ ok: false, error: 'A name in the zip is not allowed: "https://evil.example/win http://x.example www.spam.example".' });
  assert.equal(/https?:\/\/|www\./.test(link.split('\n').find((l) => l.startsWith('> '))), false, 'a refusal cannot carry a clickable address');
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

const SHA = '0123456789abcdef0123456789abcdef01234567';
const prCtx = { issue: 12, login: 'someone', repo: 'Em3ritus/umbravox-themes', sha: SHA };

test('the pull request text shows both pictures at the exact commit, names that commit, and closes the submission', () => {
  const b = prBody({ folder: 'ember', name: 'EM`BER @x', files: ['theme.json', 'emblem.bin'] }, prCtx);
  assert.ok(b.includes('Closes #12'));
  assert.ok(b.includes('https://raw.githubusercontent.com/Em3ritus/umbravox-themes/' + SHA + '/previews/ember/cyd.png'));
  assert.ok(b.includes('https://raw.githubusercontent.com/Em3ritus/umbravox-themes/' + SHA + '/previews/ember/waveshare.png'));
  assert.equal(/submit\//.test(b), false, 'no link that follows a branch');
  assert.ok(b.includes(SHA.slice(0, 12)));
  assert.equal(/@x/.test(b), false);
  assert.match(b, /Merge to approve/);
  assert.match(b, /never changes/);
});

test('the pull request text says when a clip or sounds are included, and that they are not shown', () => {
  const plain = prBody({ folder: 'ember', name: 'EMBER', files: ['theme.json', 'emblem.bin'] }, prCtx);
  assert.match(plain, /no radar clip and no alert sounds/);
  const both = prBody({ folder: 'ember', name: 'EMBER', files: ['theme.json', 'radar.vid', 'alert.snd'] }, prCtx);
  assert.match(both, /radar clip \(`radar\.vid`\)/); assert.match(both, /alert sounds \(`alert\.snd`\)/);
  assert.match(both, /not shown here/);
  assert.ok(both.includes('https://github.com/Em3ritus/umbravox-themes/tree/' + SHA + '/themes/ember'));
  const clip = prBody({ folder: 'ember', name: 'EMBER', files: ['theme.json', 'radar.vid'] }, prCtx);
  assert.match(clip, /radar clip/); assert.equal(/alert sounds \(/.test(clip), false);
});

test('a commit that is not a full hash is refused for the pull request text', () => {
  assert.throws(() => prBody({ folder: 'ember', name: 'EMBER', files: ['theme.json'] }, { ...prCtx, sha: 'submit/12' }), /commit/);
});
