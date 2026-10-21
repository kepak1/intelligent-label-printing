// Shipping code label: prints a code (or any text) with an optional QR code or
// barcode, header, date and sequence number, as a vector PDF that fits the
// paper of the profile. No DOM needed – runs in the offscreen document and on
// the preview page.

import { PDFDocument, rgb } from './lib/pdf-lib.esm.min.js';
import fontkit from './lib/fontkit.esm.min.js';
import qrcode from './lib/qrcode.mjs';
import { stringToBytes as utf8Bytes } from './lib/qrcode-utf8.mjs';
import { paperSize, isSheetMode } from './settings.js';

export { cleanCode } from './settings.js';

const MM = 72 / 25.4;
const A7 = { w: 74, h: 105 };
// A huge code is hard to scan (it doesn't fit in a scanner's view), so cap it.
const QR_MAX = 40 * MM;
const BARCODE_MAX_H = 30 * MM;
const BLACK = rgb(0, 0, 0);

// ---------- fonts ----------

let fontBytes;
function loadFonts() {
  fontBytes ??= Promise.all(['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'].map((f) =>
    fetch(chrome.runtime.getURL('lib/fonts/' + f)).then((r) => r.arrayBuffer())));
  return fontBytes;
}

// ---------- Code 128 (set B) ----------

const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231',
  '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133',
  '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131',
  '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422',
  '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211',
  '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212',
  '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113',
  '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];

// Bar widths in modules, starting with a bar: start B, data, checksum, stop.
export function code128Modules(text) {
  const values = [...text].map((c) => c.charCodeAt(0) - 32);
  const check = (104 + values.reduce((sum, v, i) => sum + v * (i + 1), 0)) % 103;
  return [104, ...values, check, 106].flatMap((v) => [...C128[v]].map(Number));
}

// ---------- text fitting ----------

// The largest font size (≤ max) at which `text` fits in `width`, on one or two lines.
function fitText(font, text, width, max, min = 6) {
  const one = Math.min(max, width / Math.max(1, font.widthOfTextAtSize(text, 1)));
  let best = { lines: [text], size: one };
  if (one < max * 0.6 && text.length > 10) {
    // try two lines, split at the space nearest the middle (or in the middle)
    const mid = text.length / 2;
    const spaces = [...text.matchAll(/ /g)].map((m) => m.index);
    const at = spaces.length ? spaces.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a)) : Math.ceil(mid);
    const lines = [text.slice(0, at).trim(), text.slice(at).trim()].filter(Boolean);
    const widest = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, 1)));
    const two = Math.min(max, width / widest, max);
    if (two > one * 1.25) best = { lines, size: two };
  }
  best.size = Math.max(min, best.size);
  best.height = best.lines.length * best.size * 1.2;
  return best;
}

function drawText(page, block, font, x, y, width) {
  // y = top of the block; lines centred in `width`
  block.lines.forEach((line, i) => {
    const w = font.widthOfTextAtSize(line, block.size);
    page.drawText(line, { x: x + (width - w) / 2, y: y - block.size * (1.2 * i + 0.95), size: block.size, font, color: BLACK });
  });
}

// ---------- symbols ----------

function qrMatrix(code) {
  qrcode.stringToBytes = utf8Bytes;
  const qr = qrcode(0, 'M');
  qr.addData(code, 'Byte');
  qr.make();
  return qr;
}

function drawQr(page, qr, x, y, side) {
  // y = bottom; 2-module quiet zone inside the square. All dark modules form one
  // path, so neighbouring modules have no anti-aliasing seams between them.
  const n = qr.getModuleCount();
  const cell = side / (n + 4);
  let path = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      const start = c;
      while (c < n && qr.isDark(r, c)) c++;
      path += `M${start + 2} ${r + 2}h${c - start}v1h${start - c}z`;
    }
  }
  // drawSvgPath uses SVG coordinates (y down) from the given top-left point
  page.drawSvgPath(path, { x, y: y + side, scale: cell, color: BLACK, borderWidth: 0 });
}

function drawBarcode(page, modules, x, y, width, height) {
  // y = bottom; one path (in points, y down from the top), no seams between bars
  const total = modules.reduce((a, b) => a + b, 0) + 20; // 10-module quiet zone on each side
  const unit = width / total;
  let pos = 10 * unit;
  let path = '';
  modules.forEach((m, i) => {
    if (i % 2 === 0) path += `M${pos.toFixed(3)} 0h${(m * unit).toFixed(3)}v${height.toFixed(3)}h${(-m * unit).toFixed(3)}z`;
    pos += m * unit;
  });
  page.drawSvgPath(path, { x, y: y + height, color: BLACK, borderWidth: 0 });
}

// ---------- layout ----------

// Plans the content for an area `w` wide and `h` high (h = null: as high as needed).
// Returns { height, draw(page, x, top) }.
function plan(el, fonts, w, h) {
  const { regular, bold } = fonts;
  const qr = el.symbol === 'qr' ? qrMatrix(el.code) : null;
  const bars = el.symbol === 'code128' ? code128Modules(el.code) : null;
  const gap = Math.min(10, Math.max(4, w * 0.04));
  const horizontal = qr && (h === null || w > h * 1.15);

  if (horizontal) {
    const side = h === null ? Math.min(Math.max(w * 0.38, 18 * MM), 36 * MM) : Math.min(h, w * 0.5, QR_MAX);
    const colW = w - side - gap;
    const blocks = textBlocks(el, fonts, colW, { header: Math.min(14, colW * 0.1), code: Math.min(28, colW * 0.16), meta: Math.min(10, colW * 0.07) });
    const colH = stackHeight(blocks, gap * 0.6);
    const height = h ?? Math.max(side, colH);
    return {
      height,
      draw(page, x, top) {
        drawQr(page, qr, x, top - (height + side) / 2, side);
        drawStack(page, blocks, fonts, x + side + gap, top - (height - colH) / 2, colW, gap * 0.6);
      },
    };
  }

  const blocks = textBlocks(el, fonts, w, { header: Math.min(18, w * 0.09), code: Math.min(36, w * 0.13), meta: Math.min(11, w * 0.06) });
  const textH = stackHeight(blocks, gap * 0.6);
  let symH = 0;
  if (qr) symH = Math.max(0, Math.min(w, h - textH - gap, QR_MAX));
  if (bars) symH = h === null ? Math.min(w * 0.3, 20 * MM) : Math.max(0, Math.min(w * 0.35, h - textH - gap, BARCODE_MAX_H));
  const content = symH ? symH + gap + textH : textH;
  const height = h ?? content;
  return {
    height,
    draw(page, x, top) {
      let y = top - (height - content) / 2;
      const header = blocks.find((b) => b.kind === 'header');
      const rest = blocks.filter((b) => b.kind !== 'header');
      if (header) {
        drawText(page, header, bold, x, y, w);
        y -= header.height + gap * 0.6;
      }
      if (qr && symH) drawQr(page, qr, x + (w - symH) / 2, y - symH, symH);
      if (bars && symH) drawBarcode(page, bars, x, y - symH, w, symH);
      if (symH) y -= symH + gap;
      drawStack(page, rest, fonts, x, y, w, gap * 0.6);
    },
  };
}

function textBlocks(el, { regular, bold }, width, max) {
  const blocks = [];
  if (el.header) blocks.push({ kind: 'header', ...fitText(bold, el.header, width, max.header) });
  blocks.push({ kind: 'code', ...fitText(bold, el.code, width, max.code, 7) });
  const meta = [el.date, el.number ? `#${el.number}` : ''].filter(Boolean).join('  ·  ');
  if (meta) blocks.push({ kind: 'meta', ...fitText(regular, meta, width, max.meta) });
  return blocks;
}

const stackHeight = (blocks, gap) => blocks.reduce((sum, b) => sum + b.height, 0) + gap * Math.max(0, blocks.length - 1);

function drawStack(page, blocks, { regular, bold }, x, top, width, gap) {
  let y = top;
  for (const b of blocks) {
    drawText(page, b, b.kind === 'meta' ? regular : bold, x, y, width);
    y -= b.height + gap;
  }
}

// Usable rectangle of a slot: inset by the margin, clipped to the printable area.
function usable(slot, page, profile) {
  const u = profile.unprintable || {};
  const m = (+profile.margin || 0) * MM;
  const x0 = Math.max(slot.x + m, (+u.l || 0) * MM);
  const y0 = Math.max(slot.y + m, (+u.b || 0) * MM);
  const x1 = Math.min(slot.x + slot.w - m, page.w - (+u.r || 0) * MM);
  const y1 = Math.min(slot.y + slot.h - m, page.h - (+u.t || 0) * MM);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

// ---------- main ----------

const round1 = (v) => Math.round(v * 10) / 10;

// code: the cleaned code; opts: settings.codeLabel; meta: { header, date, number }.
// Returns { bytes, info, override } – override = paper/media to send to the printer.
export async function buildCodeLabel(code, opts, profile, meta = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [reg, bld] = await loadFonts();
  const fonts = { regular: await doc.embedFont(reg, { subset: true }), bold: await doc.embedFont(bld, { subset: true }) };
  const el = { code, symbol: opts.symbol || 'qr', header: meta.header || '', date: meta.date || '', number: meta.number || null };

  let pageMm;
  let override = null;
  const draw = [];

  if (isSheetMode(profile)) {
    // A4: an A7 area in the corner chosen for the A6 area, with cut lines
    pageMm = { w: 210, h: 297 };
    const page = { w: pageMm.w * MM, h: pageMm.h * MM };
    const pos = profile.position || 'tl';
    const slot = {
      x: pos.endsWith('r') ? page.w - A7.w * MM : 0,
      y: pos.startsWith('b') ? 0 : page.h - A7.h * MM,
      w: A7.w * MM,
      h: A7.h * MM,
    };
    const area = usable(slot, page, profile);
    const p = plan(el, fonts, area.w, area.h);
    draw.push((pg) => p.draw(pg, area.x, area.y + area.h));
    if (profile.cutMarks !== false) {
      const line = { thickness: 0.5, color: rgb(0.6, 0.6, 0.6), dashArray: [3, 3] };
      const yEdge = pos.startsWith('b') ? slot.h : slot.y;
      const xEdge = pos.endsWith('r') ? slot.x : slot.w;
      draw.push((pg) => {
        pg.drawLine({ start: { x: 0, y: yEdge }, end: { x: page.w, y: yEdge }, ...line });
        pg.drawLine({ start: { x: xEdge, y: slot.y }, end: { x: xEdge, y: slot.y + slot.h }, ...line });
      });
    }
  } else if (profile.codeShort) {
    // continuous tape: roll width, only as long as the content needs
    const paper = paperSize(profile);
    const u = profile.unprintable || {};
    const m = (+profile.margin || 0) * MM;
    const padX = Math.max(m, (+u.l || 0) * MM) + Math.max(m, (+u.r || 0) * MM);
    const padTop = Math.max(m, (+u.t || 0) * MM);
    const padBottom = Math.max(m, (+u.b || 0) * MM);
    const width = paper.w * MM;
    const p = plan(el, fonts, width - padX, null);
    const length = Math.max((+profile.codeMinLength || 0) * MM, p.height + padTop + padBottom);
    pageMm = { w: round1(paper.w), h: round1(length / MM) };
    const left = Math.max(m, (+u.l || 0) * MM);
    draw.push((pg) => p.draw(pg, left, pageMm.h * MM - padTop - (length - padTop - padBottom - p.height) / 2));
    override = { paper: pageMm, media: `Custom.${pageMm.w}x${pageMm.h}mm`, exactPaper: true };
  } else {
    // label printer: the whole label
    pageMm = paperSize(profile);
    const page = { w: pageMm.w * MM, h: pageMm.h * MM };
    const area = usable({ x: 0, y: 0, w: page.w, h: page.h }, page, profile);
    const p = plan(el, fonts, area.w, area.h);
    draw.push((pg) => p.draw(pg, area.x, area.y + area.h));
  }

  const page = doc.addPage([pageMm.w * MM, pageMm.h * MM]);
  for (const d of draw) d(page);
  doc.setTitle(code);
  return {
    bytes: await doc.save(),
    info: { kind: 'code', code, paper: pageMm, symbol: el.symbol, labels: 1, outputPages: 1 },
    override,
  };
}
