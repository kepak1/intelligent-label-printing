// UI translations. Texts live in _locales/<language>/messages.json (Chrome's
// format, also used for the store name and description). The extension loads
// the chosen language itself, so it can be switched in the settings
// independently of Chrome's own language. Missing texts fall back to English.
// How to add a language: see TRANSLATING.md.

const DEFAULT = 'en';
const messageCache = {};
let languagesPromise;

const url = (path) => chrome.runtime.getURL(path);

async function fetchJson(path) {
  try {
    const res = await fetch(url(path));
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// { "pl": { "name": "Polski", "guide": true }, … }
export function getLanguages() {
  languagesPromise ??= fetchJson('languages.json').then((l) => l || { [DEFAULT]: { name: 'English', guide: true } });
  return languagesPromise;
}

function loadMessages(lang) {
  messageCache[lang] ??= fetchJson(`_locales/${lang}/messages.json`).then((m) => m || {});
  return messageCache[lang];
}

// Chrome locale codes use "_" (pt_BR); Intl APIs want "-" (pt-BR).
export function bcp47(lang) {
  return String(lang || DEFAULT).replace('_', '-');
}

// The browser's language if the extension has it (exact, then base language), else English.
export async function detectLanguage() {
  const languages = await getLanguages();
  const ui = (chrome.i18n?.getUILanguage?.() || navigator.language || DEFAULT).replace('-', '_');
  if (languages[ui]) return ui;
  const base = ui.split('_')[0];
  if (languages[base]) return base;
  const regional = Object.keys(languages).find((code) => code.split('_')[0] === base);
  return regional || DEFAULT;
}

// Returns t(key, vars): the text for `key` in `lang` with {placeholders} filled in.
// Plural texts use CLDR keys (key_one, key_few, key_many, key_other) and are
// chosen by vars.n.
export async function getT(lang) {
  const [base, own] = await Promise.all([loadMessages(DEFAULT), lang === DEFAULT ? null : loadMessages(lang)]);
  const rules = new Intl.PluralRules(bcp47(lang));
  const baseRules = new Intl.PluralRules(DEFAULT);

  const lookup = (key, vars) => {
    if (own?.[key]) return own[key].message;
    if (typeof vars.n === 'number') {
      const plural = own?.[`${key}_${rules.select(vars.n)}`] || own?.[`${key}_other`];
      if (plural) return plural.message;
    }
    if (base[key]) return base[key].message;
    if (typeof vars.n === 'number') {
      const plural = base[`${key}_${baseRules.select(vars.n)}`] || base[`${key}_other`];
      if (plural) return plural.message;
    }
    return undefined;
  };

  const t = (key, vars = {}) => {
    const text = lookup(key, vars);
    if (text === undefined) return key;
    return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  };
  t.lang = lang;
  t.locale = bcp47(lang);
  return t;
}

// An error whose message is a dictionary key (translated when shown).
export class I18nError extends Error {
  constructor(key, vars = {}) {
    super(key);
    this.key = key;
    this.vars = vars;
  }
}

// Translates an Error: I18nError keys and engine codes map to dictionary entries.
export function errorText(t, e) {
  if (e?.key) return t(e.key, e.vars);
  const msg = String(e?.message || e || '');
  const translated = t(msg);
  return translated === msg ? msg : translated;
}

// Fills elements marked with data-i18n (text), data-i18n-html, data-i18n-title.
export function applyI18n(t, root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}
