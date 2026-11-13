#!/usr/bin/env node
"use strict";

/**
 * Fails when the deployable Worker bundle contains a character above U+00FF.
 *
 * Why this matters: the Cloudflare Workers runtime keeps the whole script as
 * one JavaScript string in the isolate heap. V8 stores a string one byte per
 * character only when every character is U+00FF or lower; a single character
 * above that (a curly apostrophe or an ellipsis inside a regular expression,
 * an em dash in a dependency comment) makes V8 store the entire ~27 MB script
 * as UTF-16, two bytes per character. That cost about 26 MiB of the 128 MiB
 * isolate limit and left too little room to render pages, so Cloudflare killed
 * isolates with Error 1102 ("Worker exceeded resource limits"). See
 * docs/WORKER_MEMORY.md.
 *
 * esbuild escapes non-ASCII inside string literals but not inside regular
 * expression literals or comments, so write those characters as \uXXXX in
 * source, and keep `minify` on in wrangler.jsonc so dependency comments are
 * dropped.
 *
 * Usage: node scripts/check-worker-bundle-encoding.js [path/to/worker.js]
 * (default .wrangler/dry-run/worker.js, produced by `npm run check:cloudflare-bundle`).
 */
const fs = require("node:fs");
const path = require("node:path");

const LATIN1_MAX = 0xff;
const CONTEXT_CHARS = 40;

/** esbuild prints "// path/to/module" before each bundled module. */
function moduleBanners(source) {
  const banners = [];
  const pattern =
    /^\/\/ ((?:src|node_modules|\.open-next|worker|\.\.)[^\n]*)$/gm;
  for (let match = pattern.exec(source); match; match = pattern.exec(source))
    banners.push({ index: match.index, module: match[1] });
  return banners;
}

function moduleAt(banners, index) {
  let low = 0;
  let high = banners.length - 1;
  let found;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (banners[middle].index <= index) {
      found = banners[middle];
      low = middle + 1;
    } else high = middle - 1;
  }
  return found ? found.module : "(unknown module)";
}

function escapeForDisplay(text) {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0);
    out +=
      code > 0x7e || code < 0x20
        ? `\\u{${code.toString(16)}}`
        : char;
  }
  return out;
}

/**
 * @param {string} source bundle text
 * @returns {{ total: number, findings: Array<{ module: string, count: number, codePoints: string[], sample: string }> }}
 */
function findWideCharacters(source) {
  const banners = moduleBanners(source);
  const byModule = new Map();
  let total = 0;
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) <= LATIN1_MAX) continue;
    total++;
    const module = moduleAt(banners, index);
    let entry = byModule.get(module);
    if (!entry) {
      entry = {
        module,
        count: 0,
        codePoints: new Set(),
        sample: escapeForDisplay(
          source.slice(
            Math.max(0, index - CONTEXT_CHARS),
            index + CONTEXT_CHARS,
          ),
        ),
      };
      byModule.set(module, entry);
    }
    entry.count++;
    entry.codePoints.add(
      `U+${source.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0")}`,
    );
  }
  return {
    total,
    findings: [...byModule.values()]
      .map((entry) => ({ ...entry, codePoints: [...entry.codePoints].sort() }))
      .sort((a, b) => b.count - a.count),
  };
}

function main() {
  const file = path.resolve(process.argv[2] || ".wrangler/dry-run/worker.js");
  if (!fs.existsSync(file)) {
    console.error(
      `Worker bundle not found at ${file}. Run \`npm run check:cloudflare-bundle\` (it builds the dry-run bundle first).`,
    );
    process.exit(2);
  }
  const { total, findings } = findWideCharacters(fs.readFileSync(file, "utf8"));
  if (total === 0) {
    console.log(
      "Worker bundle is Latin-1 clean (V8 stores the script one byte per character).",
    );
    return;
  }
  console.error(
    `Worker bundle contains ${total} character(s) above U+00FF. This forces the whole script into UTF-16 and costs roughly 26 MiB of the 128 MiB isolate limit.`,
  );
  for (const finding of findings)
    console.error(
      `  ${finding.count}x ${finding.codePoints.join(" ")} in ${finding.module}\n    ...${finding.sample}...`,
    );
  console.error(
    "Write these as \\uXXXX escapes in source (regular expression literals are not escaped by the bundler). Comments in dependencies are dropped by `minify` in wrangler.jsonc; if one still appears, see docs/WORKER_MEMORY.md.",
  );
  process.exit(1);
}

if (require.main === module) main();

module.exports = { findWideCharacters };
