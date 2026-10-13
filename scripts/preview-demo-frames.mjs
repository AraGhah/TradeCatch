/**
 * Screenshots the demo at chosen timestamps so layout can be checked without
 * waiting for a full recording pass.
 *
 * Usage: node scripts/preview-demo-frames.mjs <platform|missed-call> [en|fr] [t1,t2,...] [baseUrl]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const cut = process.argv[2] === "missed-call" ? "missed-call" : "platform";
const locale = (process.argv[3] || "en").toLowerCase() === "fr" ? "fr" : "en";
const baseUrl = process.argv[5] || "http://localhost:3003";
const times = (process.argv[4] || "1,5,12,20,28,34,42,48,58,66,72")
  .split(",")
  .map(Number)
  .sort((a, b) => a - b);

const outDir = resolve(".tmp-frames");
mkdirSync(outDir, { recursive: true });

const pagePath = `${locale === "fr" ? "/fr" : ""}/demo-video?record=1&voice=0&cut=${cut}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${baseUrl}${pagePath}`, {
  waitUntil: "networkidle",
  timeout: 120000,
});
await page.addStyleTag({
  content: `nextjs-portal, [data-nextjs-toast] { display: none !important; }`,
});
await page.waitForTimeout(800);

const started = Date.now();
await page.keyboard.press("Space");

for (const t of times) {
  const wait = t * 1000 - (Date.now() - started);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, `${cut}-${locale}-${t}.png`) });
  console.log(`captured ${t}s`);
}

await browser.close();
