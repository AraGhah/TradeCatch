// Usage: node render_ui.mjs <spec.json> <outDir>   (renders spec.dur seconds at spec.fps as JPEG frames)
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright-core');
const [specPath, outDir] = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const f = (n) => fs.readFileSync(path.join(repo, 'src/fonts', n)).toString('base64');
const faces = [
  ['Plex', 400, 'ibm-plex-sans-latin-400-normal.woff2'], ['Plex', 500, 'ibm-plex-sans-latin-500-normal.woff2'],
  ['Plex', 600, 'ibm-plex-sans-latin-600-normal.woff2'], ['Plex', 700, 'ibm-plex-sans-latin-700-normal.woff2'],
  ['Archivo', 700, 'archivo-latin-700-normal.woff2'], ['Archivo', 800, 'archivo-latin-800-normal.woff2'],
].map(([fam, w, file]) => `@font-face{font-family:'${fam}';font-weight:${w};src:url(data:font/woff2;base64,${f(file)}) format('woff2')}`).join('\n');
const browser = await chromium.launch({ headless: true, args: ['--force-device-scale-factor=1', '--disable-lcd-text'] });
const page = await browser.newPage({ viewport: { width: spec.w || 1080, height: spec.h || 1920 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, 'ui.html')).href);
await page.addStyleTag({ content: faces });
await page.evaluate(() => document.fonts.load("600 40px Plex"));
await page.evaluate(() => document.fonts.load("800 40px Archivo"));
await page.evaluate(() => window.fontsReady());
await page.evaluate((s) => window.renderSpec(s), spec);
await page.evaluate(() => window.fontsReady());
const fps = spec.fps || 24, n = Math.round(spec.dur * fps);
const only = process.argv[4] ? new Set(process.argv[4].split(',').flatMap(tok => { const [a, b] = tok.split('-').map(Number); return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, k) => a + k); })) : null;
for (let i = 0; i < n; i++) {
  if (only && !only.has(i)) continue;
  await page.evaluate((t) => window.seek(t), i / fps);
  await page.screenshot({ path: path.join(outDir, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
}
await browser.close();
console.log(`rendered ${only ? only.size : n} frames -> ${outDir}`);
