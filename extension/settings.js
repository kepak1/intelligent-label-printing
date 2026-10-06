// Shared settings and printer profiles (Intelligent label printing).

import { makeT } from './i18n.js';

// Paper presets in mm; labels come from i18n (key paper_<id>).
export const PAPER_PRESETS = {
  A4: { w: 210, h: 297 },
  A6: { w: 105, h: 148 },
  '100x150': { w: 100, h: 150 },
  '4x6': { w: 101.6, h: 152.4 },
  custom: { w: 100, h: 150 },
};

export const A6 = { w: 105, h: 148 };

export function newProfile(overrides = {}) {
  return {
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: 'Profile',
    printer: '',
    media: '',
    copies: 1,
    printerScaling: 'none', // none = 100%, fit = the printer driver scales
    paper: 'A6',
    paperW: 105,
    paperH: 148,
    unprintable: { l: 0, t: 0, r: 0, b: 0 }, // mm, from the driver's printable area
    perSheet: 1, // A4 only
    position: 'tl', // A4 only, 1 label per sheet
    cutMarks: true, // A4 only
    margin: 2, // mm inside the label area
    autoRotate: true,
    upscale: true,
    cropMode: 'auto', // auto | all | largest | split
    padding: 1, // mm of extra space around detected content
    gap: 8, // mm – white gaps wider than this separate content blocks
    threshold: 235, // 0-255, lighter pixels count as white
    ...overrides,
  };
}

export function defaultSettings(language = 'en') {
  const t = makeT(language);
  const a4 = newProfile({ id: 'pA4', name: t('defaultProfileA4'), paper: 'A4', paperW: 210, paperH: 297, media: 'A4' });
  const a6 = newProfile({ id: 'pA6', name: t('defaultProfileA6'), paper: 'A6' });
  return {
    language,
    profiles: [a4, a6],
    activeProfileId: a4.id,
    autoPrint: { enabled: false, domains: '' },
    notifications: true,
  };
}

export function paperSize(profile) {
  if (profile.paper === 'custom') return { w: +profile.paperW || 100, h: +profile.paperH || 150 };
  const p = PAPER_PRESETS[profile.paper] || PAPER_PRESETS.A6;
  return { w: p.w, h: p.h };
}

export function isSheetMode(profile) {
  return profile.paper === 'A4';
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings || !Array.isArray(settings.profiles) || !settings.profiles.length) {
    const s = defaultSettings();
    await chrome.storage.local.set({ settings: s });
    return s;
  }
  // fill in fields added by later versions
  settings.profiles = settings.profiles.map((p) => newProfile(p));
  settings.autoPrint = { enabled: false, domains: '', ...(settings.autoPrint || {}) };
  if (settings.notifications === undefined) settings.notifications = true;
  if (!settings.language) settings.language = 'en';
  if (!settings.profiles.some((p) => p.id === settings.activeProfileId)) {
    settings.activeProfileId = settings.profiles[0].id;
  }
  return settings;
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

export function activeProfile(settings, id) {
  return settings.profiles.find((p) => p.id === (id || settings.activeProfileId)) || settings.profiles[0];
}

export function profileSummary(p, t) {
  const paper = isSheetMode(p)
    ? `A4 → A6${p.perSheet > 1 ? ` ×${p.perSheet}` : ''}`
    : p.paper === 'custom'
      ? `${p.paperW}×${p.paperH} mm`
      : p.paper === '4x6' ? '4×6"' : p.paper.replace('x', '×');
  return `${p.printer || t('noPrinter')} · ${paper}`;
}

// base64 helpers (chrome.runtime messages carry JSON only).
export function bytesToB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

export function looksLikePdf(u8) {
  const head = String.fromCharCode.apply(null, u8.subarray(0, Math.min(1024, u8.length)));
  return head.includes('%PDF');
}
