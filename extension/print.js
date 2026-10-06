import { loadSettings, activeProfile, profileSummary, b64ToBytes, bytesToB64, looksLikePdf } from './settings.js';
import { makeT, applyI18n, errorText } from './i18n.js';
import { processPdf } from './engine.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let settings;
let t;
let src = null; // { bytes, name }
let out = null; // { b64, info }
let blobUrl = null;

function setStatus(text, kind = 'info') {
  $('status').textContent = text;
  $('status').className = 'status ' + kind;
}

function profileId() { return $('profile').value; }

function renderInfo(info) {
  const rows = info.details.map((d, i) => `<tr><td>${i + 1}</td><td>${d.page}</td><td>${d.sourceMm.w}×${d.sourceMm.h}</td><td>${d.cropMm.w}×${d.cropMm.h}</td><td>${d.scale ? Math.round(d.scale * 100) + '%' : '–'}</td><td>${d.rotated ? d.rotated + '°' : '–'}</td></tr>`).join('');
  const summary = t('infoSummary', {
    labels: t('labels', { n: info.labels }), pages: info.sourcePages, out: info.outputPages,
    w: info.paper.w, h: info.paper.h, raster: info.mode === 'raster',
  });
  $('info').innerHTML = `<p class="muted">${summary}</p>
    <table><tr><th>#</th><th>${t('thPage')}</th><th>${t('thSource')}</th><th>${t('thCrop')}</th><th>${t('thScale')}</th><th>${t('thRotation')}</th></tr>${rows}</table>`;
}

function show(b64, info, autoprint = false) {
  out = { b64, info };
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(new Blob([b64ToBytes(b64)], { type: 'application/pdf' }));
  const frame = $('frame');
  frame.hidden = false;
  $('empty').hidden = true;
  frame.onload = () => { if (autoprint) setTimeout(() => sysPrint(), 400); };
  frame.src = blobUrl;
  renderInfo(info);
  ['print', 'sysprint', 'download'].forEach((id) => ($(id).disabled = false));
}

function showProfileStatus(p) {
  setStatus(t('profileStatus', { name: p.name, summary: profileSummary(p, t) }), 'info');
}

async function reprocess() {
  if (!src) return;
  const profile = activeProfile(settings, profileId());
  setStatus(t('processing'));
  try {
    const { bytes, info } = await processPdf(src.bytes, profile);
    show(bytesToB64(bytes), info);
    showProfileStatus(profile);
  } catch (e) {
    setStatus(errorText(t, e), 'err');
  }
}

async function loadFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) return setStatus(t('notPdf'), 'err');
  src = { bytes, name: file.name };
  $('file').textContent = file.name;
  await reprocess();
}

function sysPrint() {
  try {
    $('frame').contentWindow.focus();
    $('frame').contentWindow.print();
  } catch {
    window.open(blobUrl, '_blank');
  }
}

$('picker').onchange = (e) => e.target.files[0] && loadFile(e.target.files[0]);
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === drop) drop.classList.remove('over'); }));
document.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

$('profile').onchange = reprocess;
$('sysprint').onclick = sysPrint;
$('download').onclick = () => {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = (src?.name || 'label.pdf').replace(/\.pdf$/i, '') + '_label.pdf';
  a.click();
};
$('print').onclick = async () => {
  $('print').disabled = true;
  setStatus(t('sending'));
  const r = await chrome.runtime.sendMessage({ type: 'printProcessed', b64: out.b64, profileId: profileId(), name: src?.name });
  $('print').disabled = false;
  if (r?.ok) setStatus(t('sentJob', { job: r.job }), 'ok');
  else if (r?.noHost) setStatus(t('noHostPrint'), 'err');
  else setStatus(r?.error || t('printError'), 'err');
};

settings = await loadSettings();
t = makeT(settings.language);
document.documentElement.lang = settings.language;
applyI18n(t);
for (const p of settings.profiles) $('profile').add(new Option(`${p.name} (${profileSummary(p, t)})`, p.id));
$('profile').value = settings.activeProfileId;

const jobId = params.get('job');
if (jobId) {
  const job = (await chrome.storage.session.get(jobId))[jobId];
  if (job) {
    $('file').textContent = job.name;
    if (job.profileId) $('profile').value = job.profileId;
    if (job.srcB64) src = { bytes: b64ToBytes(job.srcB64), name: job.name };
    show(job.b64, job.info, params.get('autoprint') === '1');
    showProfileStatus(activeProfile(settings, job.profileId));
  } else {
    setStatus(t('jobExpired'), 'err');
  }
}
