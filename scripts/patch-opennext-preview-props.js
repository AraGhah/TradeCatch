/**
 * Patch @opennextjs/cloudflare so the Worker bundle inlines
 * `.next/server/preview-props.json`.
 *
 * Next.js 16.4 loads that file via `loadManifest` in `NextNodeServer`'s
 * constructor. OpenNext Cloudflare <= 1.20.11 only inlines `*-manifest`,
 * `required-server-files` and `prefetch-hints`, so every SSR request threw
 * "Unexpected loadManifest(/.next/server/preview-props.json) call!" (CF 1101).
 * Safe no-op when the package is missing or upstream already handles it.
 */
const fs = require("node:fs");
const path = require("node:path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "@opennextjs",
  "cloudflare",
  "dist",
  "cli",
  "build",
  "patches",
  "plugins",
  "load-manifest.js"
);

if (!fs.existsSync(target)) {
  process.exit(0);
}

const source = fs.readFileSync(target, "utf8");

if (source.includes("preview-props")) {
  process.exit(0);
}

const needle = "{*-manifest,required-server-files,prefetch-hints}.json";

if (!source.includes(needle)) {
  console.warn(
    "[patch-opennext-preview-props] Unexpected @opennextjs/cloudflare layout; skip patch."
  );
  process.exit(0);
}

fs.writeFileSync(
  target,
  source.replace(
    needle,
    "{*-manifest,required-server-files,prefetch-hints,preview-props}.json"
  )
);
console.log("[patch-opennext-preview-props] Inlined preview-props.json.");
