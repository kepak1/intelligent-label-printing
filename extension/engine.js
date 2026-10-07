// Label engine: detects content on PDF pages, crops white margins and builds
// a new PDF that fits the paper of the selected profile.
// Needs a DOM (canvas) – runs in the offscreen document and on the preview page.

import * as pdfjsLib from './lib/pdfjs/pdf.min.mjs';
import { PDFDocument, degrees, rgb } from './lib/pdf-lib.esm.min.js';
import { paperSize, isSheetMode, A6 } from './settings.js';

const LIB = chrome.runtime.getURL('lib/pdfjs/');
pdfjsLib.GlobalWorkerOptions.workerSrc = LIB + 'pdf.worker.min.mjs';

const MM = 72 / 25.4; // PDF points per millimetre
const DETECT_DPI = 100;
const RASTER_DPI = 300;

function openPdfJs(bytes) {
  return pdfjsLib.getDocument({
    data: bytes.slice(), // pdf.js takes ownership of the buffer – pass a copy
    cMapUrl: LIB + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: LIB + 'standard_fonts/',
    wasmUrl: LIB + 'wasm/',
    iccUrl: LIB + 'iccs/',
  }).promise;
}

async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
  return { canvas, ctx, viewport };
}

// Splits page content into blocks (clusters of "ink" within the gap tolerance).
// Returns rectangles in render pixels.
// Erases thin dashed or dotted lines (e.g. "cut here" lines across an A4
// sheet). They would otherwise connect the label with instructions printed
// next to it. Solid lines such as label borders are kept.
function removeDashedLines(ink, W, H, pxPerMm) {
  const edge = 2; // a thin line has no ink 2 px above/below (left/right) it
  const maxRun = 6 * pxPerMm; // longest dash
  const maxGap = 3 * pxPerMm; // longest gap between dashes
  const minRuns = 6;
  const clear = [];

  // pos(i, j): pixel index for the i-th pixel along line j; len/count: line length/number
  const scan = (len, count, pos, neighbourOffset) => {
    for (let j = edge; j < count - edge; j++) {
      const runs = [];
      let start = -1;
      for (let i = 0; i <= len; i++) {
        const p = i < len ? pos(i, j) : -1;
        const thin = p >= 0 && ink[p] && !ink[p - neighbourOffset * edge] && !ink[p + neighbourOffset * edge];
        if (thin && start < 0) start = i;
        if (!thin && start >= 0) { runs.push([start, i]); start = -1; }
      }
      // chains of short runs with short gaps
      let a = 0;
      while (a < runs.length) {
        let b = a;
        let covered = 0;
        while (b < runs.length && runs[b][1] - runs[b][0] <= maxRun && (b === a || runs[b][0] - runs[b - 1][1] <= maxGap)) {
          covered += runs[b][1] - runs[b][0];
          b++;
        }
        if (b === a) { a++; continue; }
        const extent = runs[b - 1][1] - runs[a][0];
        if (b - a >= minRuns && extent >= len * 0.25 && covered / extent <= 0.9) {
          for (let k = a; k < b; k++) for (let i = runs[k][0]; i < runs[k][1]; i++) clear.push(pos(i, j));
        }
        a = b;
      }
    }
  };
  scan(W, H, (x, y) => y * W + x, W); // horizontal lines
  scan(H, W, (y, x) => y * W + x, 1); // vertical lines
  for (const p of clear) ink[p] = 0;
}

function findBlocks(imageData, pxPerMm, { threshold, gap }) {
  const { width: W, height: H, data } = imageData;
  const ink = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < ink.length; p++, i += 4) {
    if (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold) ink[p] = 1;
  }
  removeDashedLines(ink, W, H, pxPerMm);

  const cell = Math.max(2, Math.round(pxPerMm)); // ~1 mm
  const gw = Math.ceil(W / cell);
  const gh = Math.ceil(H / cell);
  const grid = new Uint8Array(gw * gh);
  for (let y = 0; y < H; y++) {
    const gy = ((y / cell) | 0) * gw;
    for (let x = 0; x < W; x++) {
      if (ink[y * W + x]) grid[gy + ((x / cell) | 0)] = 1;
    }
  }

  // Join cells closer than `gap` (in cells) – BFS with a window.
  const reach = Math.max(1, Math.round(gap / (cell / pxPerMm)));
  const label = new Int32Array(gw * gh).fill(-1);
  const blocks = [];
  const filled = [];
  for (let i = 0; i < grid.length; i++) if (grid[i]) filled.push(i);

  for (const start of filled) {
    if (label[start] !== -1) continue;
    const id = blocks.length;
    const b = { x0: Infinity, y0: Infinity, x1: -1, y1: -1, cells: 0 };
    const queue = [start];
    label[start] = id;
    while (queue.length) {
      const c = queue.pop();
      const cx = c % gw;
      const cy = (c / gw) | 0;
      b.cells++;
      if (cx < b.x0) b.x0 = cx;
      if (cy < b.y0) b.y0 = cy;
      if (cx > b.x1) b.x1 = cx;
      if (cy > b.y1) b.y1 = cy;
      const ya = Math.max(0, cy - reach), yb = Math.min(gh - 1, cy + reach);
      const xa = Math.max(0, cx - reach), xb = Math.min(gw - 1, cx + reach);
      for (let yy = ya; yy <= yb; yy++) {
        for (let xx = xa; xx <= xb; xx++) {
          const n = yy * gw + xx;
          if (grid[n] && label[n] === -1) {
            label[n] = id;
            queue.push(n);
          }
        }
      }
    }
    blocks.push(b);
  }

  return blocks
    .map((b) => ({
      x0: b.x0 * cell,
      y0: b.y0 * cell,
      x1: Math.min(W, (b.x1 + 1) * cell),
      y1: Math.min(H, (b.y1 + 1) * cell),
      cells: b.cells,
    }))
    // drop specks (< 3 mm in both dimensions and very little ink)
    .filter((b) => (b.x1 - b.x0) / pxPerMm >= 3 || (b.y1 - b.y0) / pxPerMm >= 3 || b.cells > 6);
}

function selectRegions(blocks, cropMode, pxPerMm) {
  if (!blocks.length) return [];
  const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const union = (list) => list.reduce((u, b) => ({
    x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0),
    x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1),
  }));
  if (cropMode === 'auto') {
    // Skip small blocks (e.g. instructions next to the label). Two or more
    // similar, label-sized blocks on one page are treated as separate labels.
    const max = Math.max(...blocks.map(area));
    const big = blocks.filter((b) => area(b) >= max * 0.25);
    const labelSized = (b) => (b.x1 - b.x0) / pxPerMm >= 60 && (b.y1 - b.y0) / pxPerMm >= 60;
    if (big.length >= 2 && big.every((b) => area(b) >= max * 0.5 && labelSized(b))) {
      return selectRegions(big, 'split', pxPerMm);
    }
    return [union(big)];
  }
  if (cropMode === 'largest') {
    return [blocks.reduce((a, b) => (area(b) > area(a) ? b : a))];
  }
  if (cropMode === 'split') {
    const max = Math.max(...blocks.map(area));
    const big = blocks.filter((b) => area(b) >= max * 0.2);
    // reading order: rows from the top, then left to right
    const rowTol = Math.min(...big.map((b) => b.y1 - b.y0)) / 2;
    big.sort((a, b) => (Math.abs(a.y0 - b.y0) > rowTol ? a.y0 - b.y0 : a.x0 - b.x0));
    return big;
  }
  // all – one rectangle around all content
  return [union(blocks)];
}

// Detects labels on all pages of the document.
export async function detectLabels(pdf, profile) {
  const labels = [];
  const scale = DETECT_DPI / 72;
  const pxPerMm = DETECT_DPI / 25.4;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { ctx, canvas, viewport } = await renderPage(page, scale);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const blocks = findBlocks(img, pxPerMm, { threshold: +profile.threshold || 235, gap: +profile.gap || 8 });
    const regions = selectRegions(blocks, profile.cropMode || 'auto', pxPerMm);
    const pad = (+profile.padding || 0) * pxPerMm;
    const [vx0, vy0, vx1, vy1] = page.view; // visible page area (CropBox) in PDF units
    for (const r of regions) {
      const px = {
        x0: Math.max(0, r.x0 - pad), y0: Math.max(0, r.y0 - pad),
        x1: Math.min(canvas.width, r.x1 + pad), y1: Math.min(canvas.height, r.y1 + pad),
      };
      // pixels -> PDF coordinates (takes the page's /Rotate into account)
      const a = viewport.convertToPdfPoint(px.x0, px.y0);
      const b = viewport.convertToPdfPoint(px.x1, px.y1);
      const box = {
        left: Math.max(vx0, Math.min(a[0], b[0])),
        right: Math.min(vx1, Math.max(a[0], b[0])),
        bottom: Math.max(vy0, Math.min(a[1], b[1])),
        top: Math.min(vy1, Math.max(a[1], b[1])),
      };
      if (box.right - box.left < 1 || box.top - box.bottom < 1) continue;
      labels.push({ pageIndex: n - 1, rotate: page.rotate || 0, box, px, pageMm: { w: (vx1 - vx0) / MM, h: (vy1 - vy0) / MM } });
    }
    page.cleanup();
  }
  return labels;
}

// Target areas (in points) on the output pages. Each slot gets an `area`:
// the slot inset by the profile margin and clipped to the printable part of
// the page reported by the printer driver.
function buildSlots(profile, count) {
  const paper = paperSize(profile);
  const pageW = paper.w * MM;
  const pageH = paper.h * MM;
  const u = profile.unprintable || {};
  const printable = { x0: (+u.l || 0) * MM, y0: (+u.b || 0) * MM, x1: pageW - (+u.r || 0) * MM, y1: pageH - (+u.t || 0) * MM };
  const m = (+profile.margin || 0) * MM;
  const withArea = (slot) => {
    const x0 = Math.max(slot.x + m, printable.x0);
    const y0 = Math.max(slot.y + m, printable.y0);
    const x1 = Math.min(slot.x + slot.w - m, printable.x1);
    const y1 = Math.min(slot.y + slot.h - m, printable.y1);
    return { ...slot, area: { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) } };
  };
  const pages = [];
  if (isSheetMode(profile)) {
    const sw = A6.w * MM;
    const sh = A6.h * MM;
    const cells = {
      tl: { x: 0, y: pageH - sh }, tr: { x: sw, y: pageH - sh },
      bl: { x: 0, y: pageH - 2 * sh }, br: { x: sw, y: pageH - 2 * sh },
    };
    const per = [1, 2, 4].includes(+profile.perSheet) ? +profile.perSheet : 1;
    const order = per === 4 ? ['tl', 'tr', 'bl', 'br'] : per === 2 ? ['tl', 'tr'] : [profile.position || 'tl'];
    for (let i = 0; i < count; i += per) {
      const slots = order.slice(0, Math.min(per, count - i)).map((k) => withArea({ ...cells[k], w: sw, h: sh }));
      pages.push({ w: pageW, h: pageH, slots, cutMarks: profile.cutMarks });
    }
  } else {
    for (let i = 0; i < count; i++) pages.push({ w: pageW, h: pageH, slots: [withArea({ x: 0, y: 0, w: pageW, h: pageH })] });
  }
  return pages;
}

// Computes scale, rotation and anchor point of the content inside a slot.
function placement(label, slot, profile, contentW, contentH) {
  const { x: ax, y: ay, w: aw, h: ah } = slot.area;
  const r = ((label.rotate % 360) + 360) % 360;
  // size after applying the page's /Rotate (as the user sees it)
  const [dw, dh] = r % 180 ? [contentH, contentW] : [contentW, contentH];
  const s0 = Math.min(aw / dw, ah / dh);
  const s1 = Math.min(aw / dh, ah / dw);
  const turn = profile.autoRotate !== false && s1 > s0 * 1.02;
  let s = turn ? s1 : s0;
  if (profile.upscale === false) s = Math.min(1, s);
  // clockwise rotation; when an extra turn is needed prefer returning to the
  // original orientation (0°), then 90°
  const total = turn ? ([(r + 90) % 360, (r + 270) % 360].sort((a, b) => [0, 90, 270, 180].indexOf(a) - [0, 90, 270, 180].indexOf(b))[0]) : r;
  const [ow, oh] = total % 180 ? [contentH * s, contentW * s] : [contentW * s, contentH * s];
  const px = ax + (aw - ow) / 2;
  const py = ay + (ah - oh) / 2;
  const w = contentW * s;
  const h = contentH * s;
  // pdf-lib rotates counter-clockwise around (x, y)
  const anchor = {
    0: { x: px, y: py },
    90: { x: px, y: py + w },
    180: { x: px + w, y: py + h },
    270: { x: px + h, y: py },
  }[total];
  return { ...anchor, s, rotate: degrees(-total), total };
}

function drawCutMarks(page, pg) {
  const sw = A6.w * MM;
  const sh = A6.h * MM;
  const opts = { thickness: 0.5, color: rgb(0.6, 0.6, 0.6), dashArray: [3, 3] };
  const topY = pg.h - sh;
  const lowY = pg.slots.some((s) => s.y < topY - 1) ? pg.h - 2 * sh : topY;
  // horizontal cut lines below the A6 rows and a vertical one right of the first column
  page.drawLine({ start: { x: 0, y: topY }, end: { x: pg.w, y: topY }, ...opts });
  if (lowY !== topY) page.drawLine({ start: { x: 0, y: lowY }, end: { x: pg.w, y: lowY }, ...opts });
  page.drawLine({ start: { x: sw, y: lowY }, end: { x: sw, y: pg.h }, ...opts });
}

async function composeVector(srcBytes, labels, profile) {
  const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true, updateMetadata: false });
  const out = await PDFDocument.create();
  const embedded = [];
  for (const l of labels) {
    embedded.push(await out.embedPage(src.getPage(l.pageIndex), l.box));
  }
  layout(out, labels, profile, (page, i, slot) => {
    const e = embedded[i];
    const p = placement(labels[i], slot, profile, e.width, e.height);
    page.drawPage(e, { x: p.x, y: p.y, xScale: p.s, yScale: p.s, rotate: p.rotate });
    return p;
  });
  return out.save();
}

async function composeRaster(pdf, labels, profile) {
  const out = await PDFDocument.create();
  const images = [];
  for (const l of labels) {
    const page = await pdf.getPage(l.pageIndex + 1);
    const k = RASTER_DPI / DETECT_DPI;
    const { canvas } = await renderPage(page, RASTER_DPI / 72);
    const c = document.createElement('canvas');
    c.width = Math.round((l.px.x1 - l.px.x0) * k);
    c.height = Math.round((l.px.y1 - l.px.y0) * k);
    c.getContext('2d').drawImage(canvas, l.px.x0 * k, l.px.y0 * k, c.width, c.height, 0, 0, c.width, c.height);
    const png = await new Promise((res) => c.toBlob(res, 'image/png'));
    images.push(await out.embedPng(new Uint8Array(await png.arrayBuffer())));
    page.cleanup();
  }
  // the render is already in display orientation, so /Rotate = 0
  const flat = labels.map((l) => ({ ...l, rotate: 0 }));
  layout(out, flat, profile, (page, i, slot) => {
    const l = labels[i];
    const w = (l.px.x1 - l.px.x0) * (72 / DETECT_DPI);
    const h = (l.px.y1 - l.px.y0) * (72 / DETECT_DPI);
    const p = placement(flat[i], slot, profile, w, h);
    page.drawImage(images[i], { x: p.x, y: p.y, width: w * p.s, height: h * p.s, rotate: p.rotate });
    return p;
  });
  flat.forEach((f, i) => (labels[i].placed = f.placed));
  return out.save();
}

function layout(out, labels, profile, drawOne) {
  const pages = buildSlots(profile, labels.length);
  let i = 0;
  for (const pg of pages) {
    const page = out.addPage([pg.w, pg.h]);
    for (const slot of pg.slots) {
      labels[i].placed = drawOne(page, i, slot);
      i++;
    }
    if (pg.cutMarks) drawCutMarks(page, pg);
  }
}

// Main entry: PDF bytes + profile -> finished PDF bytes + details.
export async function processPdf(bytes, profile) {
  const pdf = await openPdfJs(bytes);
  try {
    const labels = await detectLabels(pdf, profile);
    if (!labels.length) throw new Error('NO_CONTENT');
    let out;
    let mode = 'vector';
    try {
      out = await composeVector(bytes, labels, profile);
    } catch (e) {
      console.warn('Vector composition failed, falling back to raster:', e);
      out = await composeRaster(pdf, labels, profile);
      mode = 'raster';
    }
    const paper = paperSize(profile);
    return {
      bytes: out,
      info: {
        sourcePages: pdf.numPages,
        labels: labels.length,
        outputPages: buildSlots(profile, labels.length).length,
        mode,
        paper,
        details: labels.map((l) => ({
          page: l.pageIndex + 1,
          sourceMm: { w: +l.pageMm.w.toFixed(1), h: +l.pageMm.h.toFixed(1) },
          cropMm: { w: +((l.box.right - l.box.left) / MM).toFixed(1), h: +((l.box.top - l.box.bottom) / MM).toFixed(1) },
          scale: l.placed ? +l.placed.s.toFixed(3) : null,
          rotated: l.placed ? l.placed.total : 0,
        })),
      },
    };
  } finally {
    (pdf.destroy ? pdf.destroy() : pdf.loadingTask?.destroy());
  }
}

// Renders every page of a (processed) PDF to PNG at the printer's resolution.
// Used on Windows, where the helper prints images through the printer driver.
const MAX_PIXELS = 40e6; // keeps memory in check for large sheets at high DPI

export async function rasterizePdf(bytes, dpi) {
  const pdf = await openPdfJs(bytes);
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      let scale = Math.min(Math.max(+dpi || 300, 72), 1200) / 72;
      const pixels = base.width * base.height * scale * scale;
      if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
      const { canvas } = await renderPage(page, scale);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      pages.push(new Uint8Array(await blob.arrayBuffer()));
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    return pages;
  } finally {
    (pdf.destroy ? pdf.destroy() : pdf.loadingTask?.destroy());
  }
}
