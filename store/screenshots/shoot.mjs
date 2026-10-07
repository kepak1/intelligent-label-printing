import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import fs from 'fs';
const [, , WWW, OUT, only] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', '8790', '--directory', WWW], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--hide-scrollbars', '--font-render-hinting=none'],
});
const jobs = [];
for (const lang of ['en', 'pl']) {
  for (const s of ['1', '2', '3', '4', '5']) jobs.push({ lang, s, w: 1280, h: 800, name: `screenshot-${s}-${lang}.png` });
  jobs.push({ lang, s: 'promo', w: 440, h: 280, name: `promo-small-440x280-${lang}.png` });
  jobs.push({ lang, s: 'marquee', w: 1400, h: 560, name: `promo-marquee-1400x560-${lang}.png` });
}
try {
  for (const j of jobs) {
    if (only && !j.name.includes(only)) continue;
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error(j.name, 'pageerror', e.message));
    await page.setViewport({ width: j.w, height: j.h, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:8790/slide.html?slide=${j.s}&lang=${j.lang}&w=${j.w}&h=${j.h}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.READY === true', { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 800));
    await page.screenshot({ path: `${OUT}/${j.name}`, clip: { x: 0, y: 0, width: j.w, height: j.h } });
    console.log('saved', j.name);
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
