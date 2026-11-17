// The submission form must agree with the two things that depend on it: the headings the submission reader looks
// for, and the field ids the designer's Share link fills in. (Text checks: no YAML library.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSubmission } from '../scripts/intake.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const form = read('.github/ISSUE_TEMPLATE/submit-theme.yml');
// [{id, label}] for each field that has an id, in order.
const fields = [...form.matchAll(/^ {2}- type: (\w+)\n {4}id: ([\w-]+)\n {4}attributes:\n {6}label: (.+)$/gm)].map((m) => ({ type: m[1], id: m[2], label: m[3].trim() }));

test('the fields, in order, with the ids the Share link uses and the labels the reader looks for', () => {
  assert.deepEqual(fields, [
    { type: 'input', id: 'theme-name', label: 'Theme name' },
    { type: 'input', id: 'author', label: 'Author credit' },
    { type: 'input', id: 'based-on', label: 'Based on' },
    { type: 'textarea', id: 'zip', label: 'Theme zip' },
    { type: 'checkboxes', id: 'agreement', label: 'Agreement' },
  ]);
});

test('the form is labelled as a submission and both boxes are required', () => {
  assert.match(form, /^labels: \["submission"\]$/m);
  const boxes = [...form.matchAll(/^ {8}- label: (.+)\n {10}required: true$/gm)].map((m) => m[1]);
  assert.equal(boxes.length, 2);
  assert.match(boxes[0], /right to share/);
  assert.match(boxes[1], /content rules/);
  assert.match(form, /CONTENT-RULES\.md/);
});

test('the name and the zip are required; author and based-on are not', () => {
  const block = (id) => form.slice(form.indexOf('id: ' + id), form.indexOf('  - type:', form.indexOf('id: ' + id)) >>> 0 || undefined);
  assert.match(block('theme-name'), /required: true/);
  assert.match(block('zip'), /required: true/);
  assert.equal(/required: true/.test(block('author')), false);
  assert.equal(/required: true/.test(block('based-on')), false);
});

test('a body GitHub would write from this form is accepted by the reader', () => {
  const boxes = [...form.matchAll(/^ {8}- label: (.+)$/gm)].map((m) => '- [x] ' + m[1].replace(/^"|"$/g, ''));
  const values = { 'Theme name': 'EMBER', 'Author credit': '_No response_', 'Based on': '_No response_', 'Theme zip': '[ember.zip](https://github.com/user-attachments/files/1/ember.zip)', Agreement: boxes.join('\n') };
  const body = fields.map((f) => '### ' + f.label + '\n\n' + values[f.label] + '\n').join('\n');
  const r = parseSubmission(body);
  assert.equal(r.ok, true, r.error);
});

test('the report form, the rules and the readme exist; blank issues are off', () => {
  const report = read('.github/ISSUE_TEMPLATE/report-theme.yml');
  assert.match(report, /^labels: \["report"\]$/m);
  assert.match(report, /id: theme\n/); assert.match(report, /id: reason\n/);
  assert.match(read('.github/ISSUE_TEMPLATE/config.yml'), /blank_issues_enabled: false/);
  const rules = read('CONTENT-RULES.md');
  for (const w of ['right to share', 'removed', 'Report']) assert.ok(rules.includes(w), w);
  assert.match(read('README.md'), /Share/);
});

test('no private path or address in any tracked text file', () => {
  for (const f of ['README.md', 'CONTENT-RULES.md', '.github/ISSUE_TEMPLATE/submit-theme.yml', '.github/ISSUE_TEMPLATE/report-theme.yml', 'site/index.html', 'site/gallery.js']) {
    assert.equal(/\/home\/[a-z]+|@(gmail|passmail|proton)\./i.test(read(f)), false, f);
  }
});
