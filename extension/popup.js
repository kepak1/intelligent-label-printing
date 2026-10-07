import { loadSettings, saveSettings, profileSummary } from './settings.js';
import { LANGUAGES, makeT, applyI18n } from './i18n.js';

const $ = (id) => document.getElementById(id);
let settings;
let t;

function setStatus(text, kind = 'info') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + kind;
}

function renderProfiles() {
  const box = $('profiles');
  box.textContent = '';
  for (const p of settings.profiles) {
    const b = document.createElement('button');
    b.className = 'panel profile' + (p.id === settings.activeProfileId ? ' active' : '');
    b.innerHTML = '<span class="radio"></span><span><b></b><small></small></span>';
    b.querySelector('b').textContent = p.name;
    b.querySelector('small').textContent = profileSummary(p, t);
    b.onclick = async () => {
      settings.activeProfileId = p.id;
      await saveSettings(settings);
      renderProfiles();
    };
    box.append(b);
  }
}

async function run(source, action = 'print') {
  const buttons = document.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  setStatus(t(action === 'print' ? 'statusPrinting' : 'statusPreparing'));
  try {
    const r = await chrome.runtime.sendMessage({ type: 'run', source, action });
    if (!r?.ok) return setStatus(r?.error || t('unknownError'), 'err');
    if (action === 'preview') return window.close();
    if (r.fallback) setStatus(r.fallback, 'info');
    else setStatus(t('statusSent', { labels: t('labels', { n: r.info.labels }), printer: r.printer, job: r.job }), 'ok');
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function activeTabSource() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { kind: 'url', url: tab?.url || '' };
}

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return t('justNow');
  if (s < 3600) return t('minAgo', { n: Math.round(s / 60) });
  if (s < 86400) return t('hoursAgo', { n: Math.round(s / 3600) });
  return new Date(iso).toLocaleDateString(settings.language);
}

async function renderDownloads() {
  const items = (await chrome.downloads.search({ orderBy: ['-startTime'], limit: 40, state: 'complete' }))
    .filter((d) => d.exists !== false && (d.mime === 'application/pdf' || /\.pdf$/i.test(d.filename)))
    .slice(0, 5);
  const box = $('downloads');
  box.textContent = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'dl muted';
    empty.textContent = t('noDownloads');
    box.append(empty);
    return;
  }
  for (const d of items) {
    const row = document.createElement('div');
    row.className = 'dl';
    row.innerHTML = '<span class="name"><span></span><small></small></span><button class="small primary"></button><button class="small"></button>';
    row.querySelector('.name span').textContent = d.filename.split(/[\\/]/).pop();
    row.querySelector('.name').title = d.filename;
    row.querySelector('small').textContent = timeAgo(d.startTime);
    const [pr, pv] = row.querySelectorAll('button');
    pr.textContent = t('print');
    pv.textContent = t('preview');
    pr.onclick = () => run({ kind: 'download', id: d.id });
    pv.onclick = () => run({ kind: 'download', id: d.id }, 'preview');
    box.append(row);
  }
}

async function checkHost() {
  const r = await chrome.runtime.sendMessage({ type: 'host', payload: { cmd: 'ping' } });
  $('hostState').innerHTML = `<span class="dot ${r?.ok ? 'ok' : 'err'}"></span>`;
  $('hostState').append(t(r?.ok ? 'hostOk' : 'hostMissing'));
}

function render() {
  t = makeT(settings.language);
  document.documentElement.lang = settings.language;
  applyI18n(t);
  renderProfiles();
  renderDownloads();
  checkHost();
}

$('openOptions').onclick = () => chrome.runtime.openOptionsPage();
$('openFile').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('print.html') });
$('printTab').onclick = async () => run(await activeTabSource());
$('previewTab').onclick = async () => run(await activeTabSource(), 'preview');

settings = await loadSettings();
for (const [code, name] of Object.entries(LANGUAGES)) {
  const o = new Option(code.toUpperCase(), code);
  o.title = name;
  $('lang').add(o);
}
$('lang').value = settings.language;
$('lang').onchange = async (e) => {
  settings.language = e.target.value;
  await saveSettings(settings);
  render();
};
render();
