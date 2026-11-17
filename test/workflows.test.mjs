// The workflows handle files from strangers. These checks pin the rules that keep that safe. (Text checks.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sub = read('.github/workflows/submission.yml'), pub = read('.github/workflows/publish.yml'), tests = read('.github/workflows/tests.yml');
// The text of one job: from "  <name>:" to the next job or the end.
const job = (yml, name) => { const m = new RegExp('^  ' + name + ':\\n([\\s\\S]*?)(?=^  [a-z-]+:\\n|(?![\\s\\S]))', 'm').exec(yml); assert.ok(m, 'job ' + name); return m[1]; };

test('submission.yml grants nothing by default, and the check job can only read', () => {
  assert.match(sub, /^permissions: \{\}$/m);
  const check = job(sub, 'check');
  assert.match(check, /permissions:\n {6}contents: read\n/);
  assert.equal(/^\s+[a-z-]+: write\s*$|write-all/m.test(check), false, 'no write permission and no write-all in the check job');
  assert.equal(/GH_TOKEN|github\.token/.test(check), false, 'the token is not handed to the job that touches the submission');
  assert.equal(/secrets\./.test(check), false, 'no secret reaches the job that touches the submission');
});

test('only the propose job can write, and it never runs anything from the submission', () => {
  const p = job(sub, 'propose');
  assert.match(p, /needs: check/);
  for (const perm of ['contents: write', 'pull-requests: write', 'issues: write']) assert.ok(p.includes(perm), perm);
  assert.equal(/check-pack|pack-preview|make |emsdk|\bfw\//.test(p), false, 'no firmware code and no pack parsing where the token can write');
  assert.equal(/(bash|sh|node|python3?) +_in\//.test(p), false, 'nothing from the artifact is executed');
});

test('text a stranger controls reaches a script only through an environment variable', () => {
  for (const yml of [sub, pub, tests]) {
    const lines = yml.split('\n');
    lines.forEach((l, i) => {
      if (/\$\{\{\s*github\.event\.issue\.(body|title|user\.login)|\$\{\{\s*github\.event\.(comment|pull_request)\./.test(l)) {
        assert.match(l, /^\s+[A-Z_]+: \$\{\{/, 'line ' + (i + 1) + ' must be an env: assignment: ' + l.trim());
      }
    });
  }
  assert.match(sub, /BODY: \$\{\{ github\.event\.issue\.body \}\}/);
});

test('it runs only for issues carrying the submission label, one run per issue at a time', () => {
  assert.match(sub, /^on:\n {2}issues:\n {4}types: \[opened, edited\]$/m);
  assert.match(job(sub, 'check'), /if: contains\(github\.event\.issue\.labels\.\*\.name, 'submission'\)/);
  assert.match(sub, /concurrency:\n {2}group: submission-\$\{\{ github\.event\.issue\.number \}\}/);
  assert.match(job(sub, 'check'), /timeout-minutes: \d+/);
});

test('a reviewed pull request never changes: each run gets its own branch and earlier ones are closed', () => {
  const p = job(sub, 'propose');
  assert.match(p, /branch="submit\/\$ISSUE-\$GITHUB_RUN_ID"/);
  assert.equal(/--force|-f origin|\+refs/.test(p), false, 'no force push');
  assert.equal(/gh pr edit/.test(p), false, 'an open pull request is never rewritten');
  assert.match(p, /startswith\("submit\/" \+ env\.ISSUE \+ "-"\)/);
  assert.match(p, /gh pr close .*--delete-branch/);
  assert.ok(p.indexOf('gh pr close') < p.indexOf('propose.mjs stage'), 'earlier pull requests are closed before anything is staged');
  assert.match(p, /--sha "\$\(git rev-parse HEAD\)"/);
});

test('a closed submission (approved or rejected) is not checked again', () => {
  assert.match(job(sub, 'check'), /if: contains\(github\.event\.issue\.labels\.\*\.name, 'submission'\) && github\.event\.issue\.state == 'open'/);
});

test('the download is capped and https only', () => {
  assert.match(sub, /--max-filesize 2097152/);
  assert.match(sub, /--proto '=https'/);
  assert.match(sub, /--max-time \d+/);
});

test('every third-party action is pinned to a full commit', () => {
  for (const yml of [sub, pub, tests]) {
    for (const m of yml.matchAll(/uses: ([^\s@]+)@(\S+)/g)) {
      if (!m[1].startsWith('actions/')) assert.match(m[2], /^[0-9a-f]{40}$/, m[1] + ' must be pinned to a commit');
    }
  }
});

test('the firmware is taken at the pinned tag', () => {
  assert.match(read('FIRMWARE_PIN').trim(), /^v\d+\.\d+\.\d+$/);
  assert.match(job(sub, 'check'), /repository: Em3ritus\/umbravox\n/);
  assert.match(job(sub, 'check'), /FIRMWARE_PIN/);
  assert.match(job(sub, 'check'), /persist-credentials: false/);
});

test('the artifact keeps the pack in its own folder, apart from the previews', () => {
  assert.match(job(sub, 'check'), /cp -r "_work\/out\/\$FOLDER" _work\/art\/pack\//);
});

test('there is a marked place for content screening', () => {
  assert.match(sub, /Content screening \(none yet\)/);
});

test('publish.yml runs on main and by hand only, and deploys the assembled site', () => {
  assert.match(pub, /^on:\n {2}push:\n {4}branches: \[main\]\n {2}workflow_dispatch:\n/m);
  assert.match(pub, /node scripts\/assemble-site\.mjs \. _site/);
  assert.match(pub, /pages: write/); assert.match(pub, /id-token: write/);
  assert.equal(/contents: write/.test(pub), false);
});

test('tests.yml runs npm test with read-only permissions', () => {
  assert.match(tests, /npm test/);
  assert.match(tests, /^permissions:\n {2}contents: read$/m);
});

test('the reader prints the zip address for the download step, or the refusal', () => {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'uvt-url-'));
  const body = ['### Theme name', '', 'EMBER', '', '### Author credit', '', '_No response_', '', '### Based on', '', '_No response_', '', '### Theme zip', '', 'https://github.com/user-attachments/files/5/e.zip', '', '### Agreement', '', '- [x] a\n- [x] b', ''].join('\n');
  fs.writeFileSync(path.join(d, 'ok.md'), body); fs.writeFileSync(path.join(d, 'bad.md'), body.replace('- [x] a', '- [ ] a'));
  const run = (f) => spawnSync('node', ['scripts/intake.mjs', '--body', path.join(d, f), '--url'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run('ok.md').status, 0); assert.equal(run('ok.md').stdout.trim(), 'https://github.com/user-attachments/files/5/e.zip');
  assert.equal(run('bad.md').status, 1); assert.match(run('bad.md').stdout, /tick/i);
});
