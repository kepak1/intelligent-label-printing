import { loadSettings, saveSettings, newProfile, PAPER_PRESETS, paperSize, profileSummary, isSheetMode } from './settings.js';
import { LANGUAGES, makeT, applyI18n } from './i18n.js';
import { LINKS, MIN_HELPER_VERSION, EXPECTED_EXTENSION_ID, donateUrl, helperConfigured, versionLess } from './config.js';

const $ = (id) => document.getElementById(id);
let settings;
let t;
let selectedId;
let printers = []; // from the native helper
let saveTimer;

const current = () => settings.profiles.find((p) => p.id === selectedId);
const ZERO = { l: 0, t: 0, r: 0, b: 0 };
const FROM_PAPER = '__paper__'; // media = custom size taken from the profile's paper

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveSettings(settings);
    $('saved').classList.add('on');
    setTimeout(() => $('saved').classList.remove('on'), 1200);
  }, 250);
}

// ---------- media helpers ----------

function printerOf(p) {
  return printers.find((x) => x.name === p.printer);
}

// The media the job will actually use: the selected one or the driver default.
function effectiveMedia(p) {
  if (p.media === FROM_PAPER) {
    const s = paperSize(p);
    return { code: FROM_PAPER, name: t('mediaFromPaper'), w: s.w, h: s.h };
  }
  const pr = printerOf(p);
  if (!pr) return null;
  const code = p.media || pr.defaultMedia;
  return pr.media.find((m) => m.code === code) || null;
}

function mediaLabel(m) {
  const size = m.w ? ` (${m.w}×${m.h} mm)` : '';
  return m.name && m.name !== m.code ? `${m.name}${size} · ${m.code}` : `${m.code}${size}`;
}

// Paper settings for a media size: A4 keeps the cut-to-A6 layout, anything
// else uses the exact media size so the page matches what the driver expects.
function paperForMedia(m) {
  const a4 = PAPER_PRESETS.A4;
  if (Math.abs(m.w - a4.w) <= 1 && Math.abs(m.h - a4.h) <= 1) return { paper: 'A4', paperW: a4.w, paperH: a4.h };
  return { paper: 'custom', paperW: m.w, paperH: m.h };
}

function sameSize(m, p) {
  const s = paperSize(p);
  return Math.abs(m.w - s.w) <= 1.5 && Math.abs(m.h - s.h) <= 1.5;
}

const isContinuous = (m) => /^\d+(\.\d+)?\s*mm(\s*x\d)?$/i.test(m.name || '');

// Keep each profile's non-printable edges in sync with its media (driver data).
function syncUnprintable() {
  let changed = false;
  for (const p of settings.profiles) {
    const m = p.media === FROM_PAPER ? null : effectiveMedia(p);
    if (!m?.margins) continue; // Windows: margins come from printerInfo instead
    const u = m.margins || ZERO;
    if (JSON.stringify(u) !== JSON.stringify(p.unprintable)) {
      p.unprintable = { ...u };
      changed = true;
    }
  }
  if (changed) save();
}

// ---------- rendering ----------

function renderList() {
  const list = $('list');
  list.textContent = '';
  for (const p of settings.profiles) {
    const b = document.createElement('button');
    b.className = 'item' + (p.id === selectedId ? ' sel' : '');
    b.innerHTML = '<b></b><small></small>';
    b.querySelector('b').textContent = p.name;
    if (p.id === settings.activeProfileId) {
      const star = document.createElement('span');
      star.className = 'star';
      star.textContent = ' ' + t('active');
      b.querySelector('b').append(star);
    }
    b.querySelector('small').textContent = profileSummary(p, t);
    b.onclick = () => { selectedId = p.id; renderAll(); };
    list.append(b);
  }
  const add = document.createElement('button');
  add.textContent = t('addProfile');
  add.onclick = () => {
    const p = newProfile({ name: t('newProfileName', { n: settings.profiles.length + 1 }) });
    settings.profiles.push(p);
    selectedId = p.id;
    save();
    renderAll();
  };
  list.append(add);
}

function fillPrinterSelects(p) {
  const sel = $('printer');
  sel.textContent = '';
  sel.add(new Option(t('noPrinterOption'), ''));
  for (const pr of printers) sel.add(new Option(pr.name + (pr.isDefault ? t('defaultMark') : ''), pr.name));
  if (p.printer && !printerOf(p)) sel.add(new Option(p.printer + t('unavailable'), p.printer));
  sel.value = p.printer;

  const media = $('media');
  media.textContent = '';
  const pr = printerOf(p);
  const def = pr?.media.find((m) => m.code === pr.defaultMedia);
  media.add(new Option(t('driverDefault', { media: def ? ': ' + mediaLabel(def) : pr?.defaultMedia ? ': ' + pr.defaultMedia : '' }), ''));
  const label = (m) => mediaLabel(m) + (m.code === pr?.lastUsedMedia ? t('lastUsedMark') : '');
  const group = (title, items) => {
    if (!items.length) return;
    const g = document.createElement('optgroup');
    g.label = title;
    for (const m of items) g.append(new Option(label(m), m.code));
    media.append(g);
  };
  group(t('mediaGroupCustom'), (pr?.media || []).filter((m) => m.custom));
  group(t('mediaGroupDriver'), (pr?.media || []).filter((m) => !m.custom));
  if (!pr || pr.customSupported) media.add(new Option(t('mediaFromPaper'), FROM_PAPER));
  if (p.media && p.media !== FROM_PAPER && !(pr?.media || []).some((m) => m.code === p.media)) media.add(new Option(p.media, p.media));
  media.value = p.media;
}

function renderMediaWarning(p) {
  const m = effectiveMedia(p);
  const show = !!(m && m.w && !sameSize(m, p));
  $('mediaWarn').hidden = !show;
  if (show) {
    const s = paperSize(p);
    let text = t('mediaMismatch', { media: m.name || m.code, mw: m.w, mh: m.h, pw: s.w, ph: s.h });
    if (isContinuous(m)) text += ' ' + t('continuousHint', { mw: m.w, mh: m.h });
    $('mediaWarnText').textContent = text;
  }
  const u = p.unprintable || ZERO;
  const any = ['l', 't', 'r', 'b'].some((k) => +u[k] > 0);
  $('unprintableHint').hidden = !any;
  if (any) $('unprintableHint').textContent = t('unprintable', u);
}

function renderEditor() {
  const p = current();
  $('edTitle').textContent = p.name;
  fillPrinterSelects(p);
  for (const el of document.querySelectorAll('#editor [data-k]')) {
    const k = el.dataset.k;
    if (k === 'printer' || k === 'media') continue;
    if (el.type === 'checkbox') el.checked = !!p[k];
    else el.value = p[k];
  }
  $('sheetOpts').hidden = !isSheetMode(p);
  $('customRow').hidden = p.paper !== 'custom';
  $('posField').hidden = +p.perSheet !== 1;
  for (const b of $('positions').querySelectorAll('button')) b.classList.toggle('sel', b.dataset.pos === p.position);
  $('makeActive').disabled = p.id === settings.activeProfileId;
  $('remove').disabled = settings.profiles.length < 2;
  renderMediaWarning(p);
}

function renderAll() {
  renderList();
  renderEditor();
}

function applyLanguage() {
  t = makeT(settings.language);
  document.documentElement.lang = settings.language;
  applyI18n(t);
  const donate = donateUrl(settings.language);
  $('donate').hidden = !donate;
  if (donate) $('donate').href = donate;
  const paperSel = $('paper');
  paperSel.textContent = '';
  for (const id of Object.keys(PAPER_PRESETS)) paperSel.add(new Option(t('paper_' + id), id));
  renderAll();
  renderHostStatus();
}

// ---------- events ----------

function applyMedia(p, m) {
  Object.assign(p, paperForMedia(m));
  p.unprintable = { ...(m.margins || ZERO) };
}

function bindEditor() {
  $('editor').addEventListener('change', (e) => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    const p = current();
    const k = el.dataset.k;
    if (el.type === 'checkbox') p[k] = el.checked;
    else if (el.type === 'number' || k === 'perSheet') p[k] = el.value === '' ? '' : +el.value;
    else p[k] = el.value;

    if (k === 'printer') {
      // start with the paper last used for this printer in the macOS dialog
      const pr = printerOf(p);
      p.media = pr?.media.some((m) => m.code === pr.lastUsedMedia) ? pr.lastUsedMedia : '';
      const m = effectiveMedia(p);
      if (p.media && m?.w) applyMedia(p, m);
      else p.unprintable = { ...(m?.margins || ZERO) };
    }
    if (k === 'media') {
      const m = effectiveMedia(p);
      if (p.media === FROM_PAPER) p.unprintable = { ...ZERO };
      else if (m?.w) applyMedia(p, m);
    }
    if (k === 'paper') {
      if (isSheetMode(p)) p.printerScaling = 'none';
      if (p.paper !== 'custom') Object.assign(p, { paperW: PAPER_PRESETS[p.paper].w, paperH: PAPER_PRESETS[p.paper].h });
    }
    save();
    renderAll();
    if ((k === 'printer' || k === 'media' || k === 'paperW' || k === 'paperH') && hostInfo?.platform === 'windows') {
      refreshWindowsMargins(p);
    }
  });
  $('editor').addEventListener('input', (e) => {
    if (e.target.dataset.k === 'name') {
      current().name = e.target.value;
      $('edTitle').textContent = e.target.value;
      save();
      renderList();
    }
  });
  $('useMedia').onclick = () => {
    const m = effectiveMedia(current());
    if (!m) return;
    applyMedia(current(), m);
    save();
    renderAll();
  };
  $('positions').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    current().position = b.dataset.pos;
    save();
    renderEditor();
  });
  $('makeActive').onclick = () => { settings.activeProfileId = selectedId; save(); renderAll(); };
  $('duplicate').onclick = () => {
    const copy = newProfile({ ...current(), name: current().name + t('copySuffix') });
    copy.id = 'p' + Date.now().toString(36);
    settings.profiles.push(copy);
    selectedId = copy.id;
    save();
    renderAll();
  };
  $('remove').onclick = () => {
    const p = current();
    if (!confirm(t('confirmDelete', { name: p.name }))) return;
    settings.profiles = settings.profiles.filter((x) => x.id !== p.id);
    if (settings.activeProfileId === p.id) settings.activeProfileId = settings.profiles[0].id;
    selectedId = settings.profiles[0].id;
    save();
    renderAll();
  };
  $('test').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('print.html') });
  $('refresh').onclick = (e) => { e.preventDefault(); loadPrinters(); };
}

function refreshGlobal() {
  $('lang').value = settings.language;
  $('autoEnabled').checked = settings.autoPrint.enabled;
  $('autoDomains').value = settings.autoPrint.domains;
  $('notifications').checked = settings.notifications;
}

function bindGlobal() {
  for (const [code, name] of Object.entries(LANGUAGES)) $('lang').add(new Option(name, code));
  $('lang').onchange = (e) => { settings.language = e.target.value; save(); applyLanguage(); };
  refreshGlobal();
  $('autoEnabled').onchange = (e) => { settings.autoPrint.enabled = e.target.checked; save(); };
  $('autoDomains').oninput = (e) => { settings.autoPrint.domains = e.target.value; save(); };
  $('notifications').onchange = (e) => { settings.notifications = e.target.checked; save(); };
}

// ---------- export / import ----------

const FILE_FORMAT = 'intelligent-label-printing-settings';
let pendingImport = null;

function exportSettings() {
  const data = {
    format: FILE_FORMAT,
    version: 1,
    app: chrome.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    settings,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `label-printing-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function parseImport(text) {
  const data = JSON.parse(text);
  const s = data?.format === FILE_FORMAT ? data.settings : null;
  if (!s || !Array.isArray(s.profiles) || !s.profiles.length) throw new Error('invalid');
  return { exportedAt: data.exportedAt, settings: s };
}

// Printer names differ between computers and systems ("Brother_QL_1110NWB" on
// macOS, "Brother QL-1110NWB" on Windows) – compare them without punctuation.
const normName = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function remapPrinters(profiles) {
  const remapped = [];
  const missing = [];
  if (!printers.length) return { remapped, missing };
  for (const p of profiles) {
    if (!p.printer || printers.some((x) => x.name === p.printer)) continue;
    const match = printers.find((x) => normName(x.name) === normName(p.printer));
    if (match) {
      remapped.push(`${p.printer} → ${match.name}`);
      p.printer = match.name;
    } else {
      missing.push(p.name);
    }
  }
  return { remapped, missing };
}

function showImportResult(lines, kind) {
  const el = $('importResult');
  el.hidden = false;
  el.className = 'status ' + kind;
  el.textContent = lines.filter(Boolean).join(' ');
}

async function finishImport(mode) {
  const incoming = pendingImport.settings.profiles.map((p) => newProfile(p));
  if (mode === 'replace') {
    const s = pendingImport.settings;
    settings = {
      ...settings,
      language: s.language || settings.language,
      autoPrint: { ...settings.autoPrint, ...(s.autoPrint || {}) },
      notifications: s.notifications ?? settings.notifications,
      profiles: incoming,
      activeProfileId: incoming.some((p) => p.id === s.activeProfileId) ? s.activeProfileId : incoming[0].id,
    };
  } else {
    // merge: same id (or same name) updates the existing profile, others are added
    for (const p of incoming) {
      const i = settings.profiles.findIndex((x) => x.id === p.id || x.name === p.name);
      if (i >= 0) settings.profiles[i] = { ...p, id: settings.profiles[i].id };
      else settings.profiles.push(p);
    }
  }
  const { remapped, missing } = remapPrinters(settings.profiles);
  pendingImport = null;
  $('importBox').hidden = true;
  selectedId = settings.activeProfileId;
  syncUnprintable();
  await saveSettings(settings);
  refreshGlobal();
  applyLanguage();
  showImportResult([
    t('importDone', { n: incoming.length }),
    remapped.length ? t('importRemapped', { list: remapped.join(', ') }) : '',
    missing.length ? t('importMissing', { list: missing.join(', ') }) : '',
  ], missing.length ? 'err' : 'ok');
}

function bindBackup() {
  $('exportBtn').onclick = exportSettings;
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    $('importResult').hidden = true;
    try {
      pendingImport = parseImport(await file.text());
    } catch {
      pendingImport = null;
      $('importBox').hidden = true;
      return showImportResult([t('importInvalid')], 'err');
    }
    const names = pendingImport.settings.profiles.map((p) => p.name).join(', ');
    const date = pendingImport.exportedAt ? new Date(pendingImport.exportedAt).toLocaleString(settings.language) : '?';
    $('importText').textContent = t('importFound', { n: pendingImport.settings.profiles.length, names, date });
    $('importBox').hidden = false;
  };
  $('importReplace').onclick = () => finishImport('replace');
  $('importMerge').onclick = () => finishImport('merge');
  $('importCancel').onclick = () => { pendingImport = null; $('importBox').hidden = true; };
}

// ---------- native helper ----------

let hostInfo = null;

// Windows lists paper sizes without margins – ask the driver for the chosen one.
async function refreshWindowsMargins(p) {
  if (!p.printer) return;
  const r = await chrome.runtime.sendMessage({ type: 'host', payload: {
    cmd: 'printerInfo', printer: p.printer, paper: paperSize(p),
    options: { media: p.media === FROM_PAPER ? `Custom.${paperSize(p).w}x${paperSize(p).h}mm` : p.media },
  } });
  if (!r?.ok || !r.margins) return;
  p.unprintable = { ...r.margins };
  save();
  if (p.id === selectedId) renderEditor();
}

function detectOS() {
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'mac';
  return 'other';
}

function linkButton(text, href, primary) {
  const a = document.createElement('a');
  a.className = 'button' + (primary ? ' primary' : '');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

function renderHelperInstall(needed) {
  const configured = helperConfigured();
  $('helperInstall').hidden = !needed || !configured;
  $('helperDev').hidden = !needed || configured;
  if (!needed || !configured) return;
  const os = detectOS();
  const box = $('helperButtons');
  box.textContent = '';
  if (os !== 'windows') box.append(linkButton(t('helperDownloadMac'), LINKS.helperMac, os === 'mac'));
  if (os !== 'mac') {
    box.append(linkButton(t('helperDownloadWin'), LINKS.helperWindows, os === 'windows'));
    box.append(linkButton(t('helperDownloadWinArm'), LINKS.helperWindowsArm, false));
  }
  box.append(linkButton(t('helperAllReleases'), LINKS.releases, false));
  $('helperSteps').innerHTML = os === 'windows' ? t('helperStepsWin') : t('helperStepsMac');
}

function renderHostStatus() {
  const el = $('hostStatus');
  if (!hostInfo) return;
  const outdated = hostInfo.ok && versionLess(hostInfo.version, MIN_HELPER_VERSION);
  el.innerHTML = `<span class="dot ${hostInfo.ok && !outdated ? 'ok' : 'err'}"></span>`;
  el.append(!hostInfo.ok ? t('hostNotInstalled')
    : outdated ? t('hostOutdated', { version: hostInfo.version, min: MIN_HELPER_VERSION })
      : t('hostConnected', hostInfo));
  el.title = hostInfo.ok ? '' : hostInfo.error || '';
  renderHostProblem();
  renderHelperInstall(!hostInfo.ok || outdated);
}

// Explains why Chrome could not reach the helper, based on its error message.
function renderHostProblem() {
  const box = $('hostProblem');
  const err = hostInfo && !hostInfo.ok ? String(hostInfo.error || '') : '';
  const mismatch = chrome.runtime.id !== EXPECTED_EXTENSION_ID;
  box.hidden = !err;
  if (!err) return;
  let hint = '';
  if (/forbidden/i.test(err)) hint = t('hostHintForbidden');
  else if (/not found/i.test(err)) hint = t('hostHintNotFound');
  else if (/exited|failed to start|communicating/i.test(err)) hint = t('hostHintCrashed');
  $('hostProblemText').textContent = hint;
  $('hostErrorDetail').textContent = t('hostErrorDetail', { error: err });
  $('idMismatch').hidden = !mismatch;
  if (mismatch) {
    const id = chrome.runtime.id;
    $('idMismatchText').textContent = t('idMismatch', { id, expected: EXPECTED_EXTENSION_ID });
    $('idMismatchCmd').textContent = detectOS() === 'windows'
      ? `& "$env:LOCALAPPDATA\\IntelligentLabelPrinting\\ilp-host.exe" install --extension-id ${id}` // PowerShell
      : `sudo "/Library/Application Support/IntelligentLabelPrinting/ilp-host" install --system --extension-id ${id}`;
  }
}

async function loadPrinters() {
  hostInfo = await chrome.runtime.sendMessage({ type: 'host', payload: { cmd: 'ping' } });
  printers = [];
  if (hostInfo?.ok) {
    const r = await chrome.runtime.sendMessage({ type: 'host', payload: { cmd: 'printers' } });
    printers = r?.ok ? r.printers : [];
  }
  renderHostStatus();
  syncUnprintable();
  renderAll();
}

settings = await loadSettings();
selectedId = settings.activeProfileId;
$('extId').textContent = chrome.runtime.id;
$('installCmd').textContent = 'bash ~/Labelprinter/helper/build.sh && ~/Labelprinter/dist/ilp-host-macos install';
$('checkHost').onclick = () => loadPrinters();
bindEditor();
bindGlobal();
bindBackup();
applyLanguage();
loadPrinters();
