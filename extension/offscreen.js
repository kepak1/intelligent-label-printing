// Offscreen document: pdf.js runs here (it needs a DOM/canvas and workers).
import { processPdf, rasterizePdf } from './engine.js';
import { b64ToBytes, bytesToB64 } from './settings.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  if (msg.type === 'process') {
    processPdf(b64ToBytes(msg.b64), msg.profile)
      .then(({ bytes, info }) => sendResponse({ ok: true, b64: bytesToB64(bytes), info }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === 'rasterize') {
    rasterizePdf(b64ToBytes(msg.b64), msg.dpi)
      .then((pages) => sendResponse({ ok: true, images: pages.map(bytesToB64) }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  return false;
});
