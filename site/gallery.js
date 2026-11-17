// The gallery page. cardHtml builds one theme's card as text (tested in Node); the bottom of the file fills the page
// in a browser. Every string that came from a submission goes through escapeHtml.
import { makeZip } from './zip.js';

export const DESIGNER = 'https://em3ritus.github.io/umbravox/designer/';
export const REPO = 'Em3ritus/umbravox-community-themes';
const FOLDER_RE = /^[A-Za-z0-9_-]{1,31}$/;
const PACK_FILES = ['theme.json', 'emblem.bin', 'radar.vid', 'alert.snd'];

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One theme's card. An entry whose folder is not a plain folder name gives no card at all.
export function cardHtml(t) {
  if (!t || !FOLDER_RE.test(String(t.folder))) return '';
  const f = t.folder, name = escapeHtml(t.name || f);
  const by = t.author ? '<p class="by">by ' + escapeHtml(t.author) + '</p>' : '';
  const based = FOLDER_RE.test(String(t.basedOn || ''))
    ? '<p class="based">Based on <a href="#' + t.basedOn + '">' + escapeHtml(t.basedOn) + '</a></p>' : '';
  const report = 'https://github.com/' + REPO + '/issues/new?template=report-theme.yml&amp;theme=' + f;
  return '<article class="card" id="' + f + '">' +
    '<h2>' + name + '</h2>' + by + based +
    '<div class="shots">' +
      '<figure><img src="previews/' + f + '/cyd.png" width="480" height="360" loading="lazy" alt="' + name + ' on the CYD 2.8 inch screen"><figcaption>CYD 2.8"</figcaption></figure>' +
      '<figure><img src="previews/' + f + '/waveshare.png" width="480" height="320" loading="lazy" alt="' + name + ' on the Waveshare 3.5 inch screen"><figcaption>Waveshare 3.5"</figcaption></figure>' +
    '</div>' +
    '<div class="actions">' +
      '<a class="btn go" href="' + DESIGNER + '?theme=' + f + '">Open in designer</a>' +
      '<button type="button" class="btn" data-zip="' + f + '">Download zip</button>' +
      '<a class="btn quiet" href="' + report + '" rel="noopener">Report</a>' +
    '</div>' +
    '<p class="msg" role="status"></p>' +
    '</article>';
}

// ---- browser only --------------------------------------------------------------------------------------------
async function downloadZip(entry, msg) {
  msg.textContent = 'Preparing the zip...';
  try {
    const files = [];
    for (const n of entry.files) {
      if (!PACK_FILES.includes(n)) continue;
      const r = await fetch('themes/' + entry.folder + '/' + n);
      if (!r.ok) throw new Error(n + ' could not be fetched (' + r.status + ')');
      files.push({ path: entry.folder + '/' + n, data: new Uint8Array(await r.arrayBuffer()) });
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([makeZip(files)], { type: 'application/zip' }));
    a.download = entry.folder + '.zip';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    msg.textContent = 'Downloaded ' + entry.folder + '.zip. Unzip it and copy the ' + entry.folder + ' folder into the themes folder on the SD card.';
  } catch (e) { msg.textContent = 'The zip could not be made: ' + e.message + '.'; }
}

async function start() {
  const host = document.getElementById('cards'), status = document.getElementById('status');
  let index;
  try {
    const r = await fetch('index.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    index = await r.json();
  } catch (e) { status.textContent = 'The list of themes could not be loaded. Try again in a moment.'; return; }
  const themes = Array.isArray(index.themes) ? index.themes : [];
  const html = themes.map(cardHtml).join('');
  if (!html) { status.textContent = 'No themes yet. Make one in the designer and press Share.'; return; }
  status.textContent = themes.length === 1 ? '1 theme' : themes.length + ' themes';
  host.innerHTML = html;                                       // built by cardHtml: every submitted string is escaped
  host.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-zip]');
    if (!b) return;
    const entry = themes.find((t) => t.folder === b.dataset.zip);
    if (entry) downloadZip(entry, b.closest('.card').querySelector('.msg'));
  });
}

if (typeof document !== 'undefined') start();
