import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
const MM = 72 / 25.4;
const OUT = process.argv[2];

// deterministic pseudo-random
let seed = 7;
const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);

function barcode(p, x, y, w, h) {
  let cx = x;
  while (cx < x + w - 2) {
    const bw = [0.6, 0.9, 1.3, 1.9][Math.floor(rnd() * 4)];
    p.drawRectangle({ x: cx, y, width: bw, height: h, color: rgb(0, 0, 0) });
    cx += bw + [0.6, 0.9, 1.4][Math.floor(rnd() * 3)];
  }
}
function matrix(p, x, y, size, n) {
  const c = size / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const finder = (i < 7 && j < 7) || (i < 7 && j >= n - 7) || (i >= n - 7 && j < 7);
    let on = rnd() > 0.5;
    if (finder) {
      const a = i % (n - 7), b = j % (n - 7);
      const ii = i < 7 ? i : i - (n - 7), jj = j < 7 ? j : j - (n - 7);
      on = ii === 0 || ii === 6 || jj === 0 || jj === 6 || (ii >= 2 && ii <= 4 && jj >= 2 && jj <= 4);
    }
    if (on) p.drawRectangle({ x: x + j * c, y: y + size - (i + 1) * c, width: c, height: c, color: rgb(0, 0, 0) });
  }
}

async function label(p, f, fb, x, y, w, h) {
  const k = rgb(0, 0, 0);
  p.drawRectangle({ x, y, width: w, height: h, borderColor: k, borderWidth: 1.4 });
  // header
  p.drawRectangle({ x, y: y + h - 34, width: w, height: 34, color: k });
  p.drawText('EXPRESS 24', { x: x + 10, y: y + h - 24, size: 17, font: fb, color: rgb(1, 1, 1) });
  p.drawText('PARCEL  1/1', { x: x + w - 82, y: y + h - 22, size: 10, font: fb, color: rgb(1, 1, 1) });
  // routing
  p.drawText('WAW-3', { x: x + 10, y: y + h - 78, size: 36, font: fb });
  p.drawText('Route  PL-31  /  Hub 07', { x: x + 10, y: y + h - 94, size: 8, font: f });
  matrix(p, x + w - 78, y + h - 108, 66, 25);
  p.drawLine({ start: { x, y: y + h - 116 }, end: { x: x + w, y: y + h - 116 }, thickness: 1 });
  // addresses
  const col = (tx, ty, title, lines, big) => {
    p.drawText(title, { x: tx, y: ty, size: 7, font: fb });
    lines.forEach((l, i) => p.drawText(l, { x: tx, y: ty - 13 - i * (big ? 13 : 10), size: big && i === 0 ? 12 : big ? 10 : 8, font: big && i === 0 ? fb : f }));
  };
  col(x + 10, y + h - 130, 'SHIP TO', ['Anna Nowak', 'ul. Kwiatowa 5/12', '30-001 Krakow', 'Poland', 'tel. +48 600 100 200'], true);
  p.drawLine({ start: { x, y: y + h - 212 }, end: { x: x + w, y: y + h - 212 }, thickness: 1 });
  col(x + 10, y + h - 224, 'FROM', ['Example Shop Ltd.', '12 Market Street', '00-950 Warsaw, Poland'], false);
  p.drawText('Weight: 1.2 kg', { x: x + w - 92, y: y + h - 237, size: 8, font: f });
  p.drawText('Date: 2026-10-07', { x: x + w - 92, y: y + h - 247, size: 8, font: f });
  p.drawText('Ref: ORDER-48213', { x: x + w - 92, y: y + h - 257, size: 8, font: f });
  p.drawLine({ start: { x, y: y + h - 272 }, end: { x: x + w, y: y + h - 272 }, thickness: 1 });
  // barcode
  barcode(p, x + 16, y + 34, w - 32, 66);
  p.drawText('PL 3104 5521 8890 1274', { x: x + w / 2 - 62, y: y + 18, size: 11, font: fb });
}

const d = await PDFDocument.create();
const f = await d.embedFont(StandardFonts.Helvetica);
const fb = await d.embedFont(StandardFonts.HelveticaBold);
const p = d.addPage([210 * MM, 297 * MM]);
await label(p, f, fb, 6 * MM, 297 * MM - 6 * MM - 136 * MM, 93 * MM, 136 * MM);
// dashed cut lines and instructions on the rest of the sheet
const g = rgb(0.55, 0.55, 0.55);
p.drawLine({ start: { x: 0, y: 297 * MM - 148 * MM }, end: { x: 210 * MM, y: 297 * MM - 148 * MM }, thickness: 0.6, color: g, dashArray: [4, 3] });
p.drawLine({ start: { x: 105 * MM, y: 297 * MM }, end: { x: 105 * MM, y: 297 * MM - 148 * MM }, thickness: 0.6, color: g, dashArray: [4, 3] });
const inst = ['How to send your parcel', '1. Cut out the label along the dashed line.', '2. Attach it to the largest side of the parcel.', '3. Do not cover or fold the barcode.', '4. Hand the parcel to the courier or drop it at a pickup point.'];
inst.forEach((t, i) => p.drawText(t, { x: 114 * MM, y: 297 * MM - 20 * MM - i * 15, size: i ? 9 : 12, font: i ? f : fb }));
fs.writeFileSync(OUT, await d.save());
console.log('ok');
