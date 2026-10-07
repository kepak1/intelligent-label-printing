// Intelligent label printing – service worker: fetches the PDF, has it processed
// (offscreen document) and prints it through the native helper (CUPS `lp`).

import { loadSettings, activeProfile, paperSize, bytesToB64, b64ToBytes, looksLikePdf } from './settings.js';
import { makeT, errorText, I18nError } from './i18n.js';

const HOST = 'com.intelligent_label_printing.host';

// ---------- native helper ----------

function native(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST, msg, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, noHost: true, error: chrome.runtime.lastError.message });
        else resolve(res || { ok: false, error: 'Empty response from the helper' });
      });
    } catch (e) {
      resolve({ ok: false, noHost: true, error: String(e.message || e) });
    }
  });
}

async function readViaHost(path) {
  const parts = [];
  let offset = 0;
  for (;;) {
    const r = await native({ cmd: 'read', path, offset });
    if (!r.ok) throw r.noHost ? new I18nError('errHostNeededRead') : new Error(r.error);
    const chunk = b64ToBytes(r.data);
    parts.push(chunk);
    offset += chunk.length;
    if (r.eof || !chunk.length) break;
  }
  const out = new Uint8Array(offset);
  let p = 0;
  for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}

// ---------- PDF sources ----------

function nameFromUrl(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split('/').pop() || u.hostname) || 'label.pdf';
  } catch { return 'label.pdf'; }
}

// file:///Users/x/a.pdf -> /Users/x/a.pdf, file:///C:/Users/x/a.pdf -> C:/Users/x/a.pdf,
// file://server/share/a.pdf -> //server/share/a.pdf (Windows network share)
function fileUrlToPath(url) {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname);
  if (u.hostname) return `//${u.hostname}${path}`;
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

async function getBytes(source) {
  if (source.kind === 'bytes') return { bytes: b64ToBytes(source.b64), name: source.name || 'label.pdf' };
  if (source.kind === 'download') {
    const [item] = await chrome.downloads.search({ id: source.id });
    if (!item) throw new I18nError('errDownloadMissing');
    return { bytes: await readViaHost(item.filename), name: item.filename.split(/[\\/]/).pop() };
  }
  if (source.kind === 'url') {
    const url = source.url || '';
    if (url.startsWith('file://')) {
      return { bytes: await readViaHost(fileUrlToPath(url)), name: nameFromUrl(url) };
    }
    if (!/^https?:/.test(url)) throw new I18nError('errTabUnreadable');
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new I18nError('errHttp', { status: res.status });
    return { bytes: new Uint8Array(await res.arrayBuffer()), name: nameFromUrl(url) };
  }
  throw new I18nError('errUnknownSource');
}

// ---------- processing in the offscreen document ----------

let offscreenReady = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  if (!offscreenReady) {
    offscreenReady = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS', 'BLOBS'],
      justification: 'Rendering and cropping label PDFs (pdf.js / pdf-lib).',
    }).catch((e) => { if (!String(e).includes('single offscreen')) throw e; })
      .finally(() => { offscreenReady = null; });
  }
  await offscreenReady;
}

async function offscreenCall(msg) {
  await ensureOffscreen();
  for (let attempt = 0; ; attempt++) {
    try {
      return await chrome.runtime.sendMessage({ target: 'offscreen', ...msg });
    } catch (e) {
      // the offscreen module may not have registered its listener yet
      if (attempt > 20 || !String(e).includes('Receiving end')) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function processBytes(bytes, profile) {
  const res = await offscreenCall({ type: 'process', b64: bytesToB64(bytes), profile });
  if (!res?.ok) throw res?.error ? new Error(res.error) : new I18nError('errProcessing');
  return res;
}

// ---------- printing ----------

// '__paper__' means: send the profile's paper size as a custom size.
function mediaFor(profile) {
  if (profile.media !== '__paper__') return profile.media;
  const { w, h } = paperSize(profile);
  return `Custom.${w}x${h}mm`;
}

// macOS / Linux helpers take the PDF; the Windows helper takes page images
// rendered at the printer's resolution (format reported by "ping").
async function nativePrint(b64, profile, title) {
  const ping = await native({ cmd: 'ping' });
  if (!ping.ok) return ping;
  const job = {
    cmd: 'print',
    printer: profile.printer,
    title,
    paper: paperSize(profile),
    options: { copies: profile.copies, media: mediaFor(profile), scaling: profile.printerScaling },
  };
  if (ping.format === 'image') {
    const info = await native({ ...job, cmd: 'printerInfo' });
    if (!info.ok) return info;
    const res = await offscreenCall({ type: 'rasterize', b64, dpi: info.dpi });
    if (!res?.ok) return { ok: false, error: res?.error || 'Rendering failed' };
    job.images = res.images;
  } else {
    job.data = b64;
  }
  return native(job);
}

async function openPreview(job, autoPrint) {
  const id = 'job_' + Date.now().toString(36);
  // keep only the latest job so storage.session stays under its quota
  const old = Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith('job_'));
  if (old.length) await chrome.storage.session.remove(old);
  await chrome.storage.session.set({ [id]: job }).catch(async () => {
    await chrome.storage.session.set({ [id]: { ...job, srcB64: null } }); // source too large – store without it
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`print.html?job=${id}${autoPrint ? '&autoprint=1' : ''}`) });
}

function notify(settings, title, message) {
  if (!settings.notifications) return;
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 0 });
}

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
  if (text && text !== '…') setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000);
}

// action: 'print' | 'preview' | 'process'
async function run(source, { profileId, action = 'print' } = {}) {
  const settings = await loadSettings();
  const t = makeT(settings.language);
  const profile = activeProfile(settings, profileId);
  badge('…', '#64748b');
  try {
    const { bytes, name } = await getBytes(source);
    if (!looksLikePdf(bytes)) throw new I18nError('errNotPdf');
    const srcB64 = bytesToB64(bytes);
    const { b64, info } = await processBytes(bytes, profile);
    const job = { name, profileId: profile.id, b64, info, srcB64: srcB64.length < 6e6 ? srcB64 : null };

    if (action === 'process') { badge(''); return { ok: true, ...job }; }
    if (action === 'preview') { await openPreview(job, false); badge(''); return { ok: true, info }; }

    if (!profile.printer) {
      await openPreview(job, true);
      badge('');
      return { ok: true, info, fallback: t('fallbackNoPrinter') };
    }
    const r = await nativePrint(b64, profile, name);
    if (r.noHost) {
      await openPreview(job, true);
      badge('');
      return { ok: true, info, fallback: t('fallbackNoHost') };
    }
    if (!r.ok) throw new I18nError('errPrinter', { error: r.error });
    badge('✓', '#16a34a');
    notify(settings, t('notifSentTitle'), t('notifSentBody', { name, printer: profile.printer, labels: t('labels', { n: info.labels }) }));
    return { ok: true, info, job: r.job, printer: profile.printer };
  } catch (e) {
    console.error(e);
    const text = errorText(t, e);
    badge('!', '#dc2626');
    notify(settings, t('notifErrorTitle'), text);
    return { ok: false, error: text };
  }
}

// ---------- context menu ----------

const MENU_CONTEXTS = ['link', 'page', 'frame'];

async function rebuildMenus() {
  const settings = await loadSettings();
  const t = makeT(settings.language);
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'root', title: t('appName'), contexts: MENU_CONTEXTS });
  for (const p of settings.profiles) {
    chrome.contextMenus.create({
      id: 'print:' + p.id,
      parentId: 'root',
      title: t('menuPrint', { name: p.name }) + (p.id === settings.activeProfileId ? ' ★' : ''),
      contexts: MENU_CONTEXTS,
    });
  }
  chrome.contextMenus.create({ id: 'sep', parentId: 'root', type: 'separator', contexts: MENU_CONTEXTS });
  chrome.contextMenus.create({ id: 'preview', parentId: 'root', title: t('menuPreview'), contexts: MENU_CONTEXTS });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.linkUrl || info.frameUrl || info.pageUrl || tab?.url;
  const source = { kind: 'url', url };
  if (info.menuItemId === 'preview') run(source, { action: 'preview' });
  else if (String(info.menuItemId).startsWith('print:')) run(source, { profileId: info.menuItemId.slice(6) });
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await rebuildMenus();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(rebuildMenus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) rebuildMenus();
});

// ---------- keyboard shortcut ----------

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'print-current') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) run({ kind: 'url', url: tab.url });
});

// ---------- automatic printing of downloaded PDFs ----------

function matchesDomain(item, domains) {
  const list = domains.split(/[\s,;]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return false;
  const hosts = [item.url, item.finalUrl, item.referrer].map((u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } });
  return hosts.some((h) => h && list.some((d) => h === d || h.endsWith('.' + d)));
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (delta.state?.current !== 'complete') return;
  const settings = await loadSettings();
  if (!settings.autoPrint.enabled) return;
  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item) return;
  const isPdf = item.mime === 'application/pdf' || /\.pdf$/i.test(item.filename);
  if (isPdf && matchesDomain(item, settings.autoPrint.domains)) run({ kind: 'download', id: item.id });
});

// ---------- messages from the popup / extension pages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false;
  (async () => {
    switch (msg?.type) {
      case 'run':
        return run(msg.source, { profileId: msg.profileId, action: msg.action });
      case 'host':
        return native(msg.payload);
      case 'printProcessed': {
        const settings = await loadSettings();
        const t = makeT(settings.language);
        const profile = activeProfile(settings, msg.profileId);
        if (!profile.printer) return { ok: false, noPrinter: true, error: t('errNoPrinter') };
        const r = await nativePrint(msg.b64, profile, msg.name || 'Label');
        if (r.ok) notify(settings, t('notifSentTitle'), `${msg.name || 'Label'} → ${profile.printer}`);
        return r;
      }
      default:
        return { ok: false, error: 'Unknown message' };
    }
  })().then(sendResponse);
  return true;
});
