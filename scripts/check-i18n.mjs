#!/usr/bin/env node
// Checks the translations in extension/_locales against English.
//   errors   (fail the check): broken JSON, unknown {placeholders}, changed HTML tags,
//            "$" in texts, key names Chrome rejects, languages.json out of sync with
//            the folders or user guides, store texts that are too long
//   warnings (do not fail):  missing or extra texts – missing ones fall back to English
// Run locally: node scripts/check-i18n.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = path.join(ROOT, 'extension', '_locales');
const LANGS_FILE = path.join(ROOT, 'extension', 'languages.json');
const GUIDES = path.join(ROOT, 'docs', 'guide');
const IN_CI = !!process.env.GITHUB_ACTIONS;

let errors = 0;
let warnings = 0;
const rel = (p) => path.relative(ROOT, p);
function report(level, file, msg) {
  if (level === 'error') errors++;
  else warnings++;
  if (IN_CI) console.log(`::${level} file=${rel(file)}::${msg}`);
  else console.log(`${level === 'error' ? 'ERROR' : 'warning'}  ${rel(file)}: ${msg}`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    report('error', file, `cannot read JSON: ${e.message}`);
    return null;
  }
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
const baseKey = (k) => k.replace(PLURAL, '');
const placeholders = (s) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
const tags = (s) => [...s.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)].map((m) => m[0].replace(/\s.*?>$/, '>').toLowerCase()).sort().join(' ');

// ---- languages.json <-> folders <-> guides
const languages = readJson(LANGS_FILE) || {};
const folders = fs.readdirSync(LOCALES).filter((d) => fs.existsSync(path.join(LOCALES, d, 'messages.json')));
for (const code of Object.keys(languages)) {
  if (!folders.includes(code)) report('error', LANGS_FILE, `"${code}" is listed but extension/_locales/${code}/messages.json does not exist`);
  if (!languages[code]?.name) report('error', LANGS_FILE, `"${code}" needs a "name" (the language's own name, e.g. "Deutsch")`);
  const guide = path.join(GUIDES, `${code}.md`);
  if (languages[code]?.guide && !fs.existsSync(guide)) report('error', LANGS_FILE, `"${code}" has "guide": true but docs/guide/${code}.md does not exist`);
  if (!languages[code]?.guide && fs.existsSync(guide)) report('warning', LANGS_FILE, `docs/guide/${code}.md exists – set "guide": true for "${code}"`);
}
for (const code of folders) {
  if (!languages[code]) report('error', LANGS_FILE, `extension/_locales/${code} exists but "${code}" is not listed in extension/languages.json`);
}

// ---- English reference
const enFile = path.join(LOCALES, 'en', 'messages.json');
const en = readJson(enFile);
if (!en) process.exit(1);
const enBases = new Set(Object.keys(en).map(baseKey));
const enText = (key) => en[key]?.message ?? en[`${baseKey(key)}_other`]?.message ?? '';

const summary = [];
for (const code of folders.sort()) {
  const file = path.join(LOCALES, code, 'messages.json');
  const msgs = readJson(file);
  if (!msgs) continue;

  const seen = new Map();
  for (const [key, entry] of Object.entries(msgs)) {
    if (!/^[A-Za-z0-9_@]+$/.test(key) || key.startsWith('@@')) report('error', file, `invalid key name "${key}" (letters, digits and _ only)`);
    const lower = key.toLowerCase();
    if (seen.has(lower)) report('error', file, `"${key}" and "${seen.get(lower)}" differ only in letter case – Chrome treats them as the same key`);
    seen.set(lower, key);
    if (typeof entry?.message !== 'string') {
      report('error', file, `"${key}" must look like { "message": "…" }`);
      continue;
    }
    const text = entry.message;
    if (text.includes('$')) report('error', file, `"${key}": "$" is not allowed (Chrome reads $…$ as a placeholder)`);
    if (code === 'en') continue;

    if (!en[key] && !enBases.has(baseKey(key))) {
      report('warning', file, `"${key}" does not exist in English – remove it or check the key name`);
      continue;
    }
    const ref = enText(key);
    for (const p of placeholders(text)) {
      if (!placeholders(ref).has(p)) report('error', file, `"${key}": unknown placeholder {${p}} – use only ${[...placeholders(ref)].map((x) => `{${x}}`).join(', ') || 'none'}`);
    }
    for (const p of placeholders(ref)) {
      if (!placeholders(text).has(p)) report('warning', file, `"${key}": {${p}} from the English text is missing`);
    }
    if (tags(text) !== tags(ref)) report('error', file, `"${key}": HTML tags must match the English text (${tags(ref) || 'none'})`);
  }

  if (msgs.extName && msgs.extName.message.length > 75) report('error', file, `extName is longer than 75 characters`);
  if (msgs.extDescription && msgs.extDescription.message.length > 132) report('error', file, `extDescription is ${msgs.extDescription.message.length} characters – the store allows 132`);

  // completeness: every English text (plural groups count once) should exist
  let missing = [];
  if (code !== 'en') {
    const have = new Set(Object.keys(msgs).map((k) => (PLURAL.test(k) && enBases.has(baseKey(k)) && !en[k.replace(PLURAL, '')] ? baseKey(k) : k)));
    const needed = new Set(Object.keys(en).map((k) => (PLURAL.test(k) && !en[baseKey(k)] ? baseKey(k) : k)));
    missing = [...needed].filter((k) => !have.has(k) && !msgs[k]);
    if (missing.length) report('warning', file, `${missing.length} text(s) not translated yet (English is shown instead): ${missing.join(', ')}`);
    const total = needed.size;
    summary.push([code, languages[code]?.name || '?', Math.round(((total - missing.length) / total) * 100)]);
  }
}

console.log('');
for (const [code, name, pct] of summary) console.log(`${code.padEnd(6)} ${name.padEnd(14)} ${pct}% translated`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = summary.map(([code, name, pct]) => `| ${code} | ${name} | ${pct}% |`).join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Translations\n\n| Code | Language | Translated |\n|---|---|---|\n${rows}\n\n${errors} error(s), ${warnings} warning(s)\n`);
}
console.log(`\n${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
