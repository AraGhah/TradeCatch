#!/usr/bin/env node
/**
 * Fails if git-tracked media violates the demo budget / forbidden intermediates.
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MAX_TRACKED_DEMO_MB = 80;
// Prefer CDN/object-storage + modern WebM/AV1 variants for delivery; keep
// git-tracked MP4s under this budget for repo size only.

function trackedFiles() {
  try {
    return execSync("git ls-files -z", { cwd: ROOT, encoding: "buffer" })
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } catch {
    return [];
  }
}

const files = trackedFiles();
const errors = [];
const forbidden = [
  /^public\/demo-video\/exports\//,
  /\.wav$/i,
  /\/\.tmp\//,
  /^TradeCatch-Demo-.*\.(mp4|webm)$/,
  /^public\/demo-video\/.*\.webm$/i,
];

let demoBytes = 0;
for (const rel of files) {
  if (forbidden.some((re) => re.test(rel.replace(/\\/g, "/")))) {
    errors.push(`Tracked forbidden media path: ${rel}`);
  }
  const norm = rel.replace(/\\/g, "/");
  if (norm.startsWith("public/demo-video/")) {
    try {
      demoBytes += fs.statSync(path.join(ROOT, rel)).size;
    } catch {
      // missing blob
    }
  }
}

const demoMb = demoBytes / (1024 * 1024);
if (demoMb > MAX_TRACKED_DEMO_MB) {
  errors.push(
    `Tracked public/demo-video is ${demoMb.toFixed(1)} MB (max ${MAX_TRACKED_DEMO_MB}). Keep one EN + one FR optimized MP4.`,
  );
}

if (errors.length) {
  console.error("Repository media check failed:");
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}

console.log(
  `Media check OK (tracked public/demo-video ≈ ${demoMb.toFixed(1)} MB)`,
);
