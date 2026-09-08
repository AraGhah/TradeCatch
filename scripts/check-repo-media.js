#!/usr/bin/env node
/**
 * Fails if shipped media violates the demo budget or local intermediates could
 * leak into a deployment artifact.
 */
const { execFileSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const ffmpeg = require("ffmpeg-static");

const ROOT = path.join(__dirname, "..");
const MAX_TRACKED_DEMO_MB = 80;
const LOCALES = ["en", "fr"];
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

function containsFiles(directory) {
  if (!fs.existsSync(directory)) return false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isFile() || (entry.isDirectory() && containsFiles(child))) {
      return true;
    }
  }
  return false;
}

const legacyExportDir = path.join(ROOT, "public/demo-video/exports");
if (containsFiles(legacyExportDir)) {
  errors.push(
    "Local demo exports exist under public/demo-video/exports and would be copied into the deployment. Move them to .artifacts/demo-video/exports.",
  );
}

function durationSeconds(file) {
  if (!ffmpeg) throw new Error("ffmpeg-static did not provide a binary");
  let stderr = "";
  try {
    execFileSync(ffmpeg, ["-i", file], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    stderr = error.stderr?.toString() || "";
  }
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!match) throw new Error(`Could not read media duration: ${file}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function timestampSeconds(value) {
  const match = value.match(/(\d+):(\d+):(\d+\.\d+)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function lastCaptionEnd(vtt) {
  const timestamps = [...vtt.matchAll(/-->\s*(\d+:\d+:\d+\.\d+)/g)];
  return timestamps.length
    ? timestampSeconds(timestamps[timestamps.length - 1][1])
    : null;
}

function timelineWindows() {
  const source = fs.readFileSync(
    path.join(ROOT, "src/components/demo-video/timeline.ts"),
    "utf8",
  );
  const result = {};
  for (const locale of LOCALES) {
    const block = source.match(new RegExp(`${locale}:\\s*\\{([^}]*)\\}`, "m"));
    const values = block
      ? [...block[1].matchAll(/(\d+)\s*:\s*(\d+)/g)]
          .sort((a, b) => Number(a[1]) - Number(b[1]))
          .map((entry) => Number(entry[2]))
      : [];
    if (values.length !== 8) {
      errors.push(`Could not read eight ${locale.toUpperCase()} scene windows`);
    }
    result[locale] = values;
  }
  return result;
}

const windows = timelineWindows();
const honestyMarkers = {
  en: ["controlled pilot", "illustrative", "not self-serve SaaS"],
  fr: ["pilote contrôlé", "illustratifs", "sans SaaS en libre-service"],
};

for (const locale of LOCALES) {
  const upper = locale.toUpperCase();
  const videoPath = path.join(
    ROOT,
    "public/demo-video",
    `TradeCatch-Demo-${upper}.mp4`,
  );
  const captionsPath = path.join(
    ROOT,
    "public/demo-video/captions",
    `${locale}.vtt`,
  );

  try {
    const videoDuration = durationSeconds(videoPath);
    const expectedDuration = windows[locale].reduce((sum, value) => sum + value, 0);
    if (Math.abs(videoDuration - expectedDuration) > 0.75) {
      errors.push(
        `${upper} MP4 is ${videoDuration.toFixed(2)}s but the timeline is ${expectedDuration}s`,
      );
    }

    const captions = fs.readFileSync(captionsPath, "utf8");
    const normalizedCaptions = captions.replace(/\s+/g, " ");
    if (!captions.replace(/^\uFEFF/, "").startsWith("WEBVTT")) {
      errors.push(`${upper} captions do not start with WEBVTT`);
    }
    const captionEnd = lastCaptionEnd(captions);
    if (captionEnd === null || Math.abs(captionEnd - videoDuration) > 0.75) {
      errors.push(
        `${upper} captions end at ${captionEnd ?? "unknown"}s but the MP4 is ${videoDuration.toFixed(2)}s`,
      );
    }
    for (const marker of honestyMarkers[locale]) {
      if (!normalizedCaptions.includes(marker)) {
        errors.push(`${upper} captions are missing honesty marker: ${marker}`);
      }
    }

    for (let scene = 1; scene <= 8; scene += 1) {
      const narrationPath = path.join(
        ROOT,
        "public/demo-video/narration",
        locale,
        `scene-${scene}.mp3`,
      );
      const narrationDuration = durationSeconds(narrationPath);
      const sceneWindow = windows[locale][scene - 1];
      if (sceneWindow && narrationDuration + 0.25 > sceneWindow) {
        errors.push(
          `${upper} narration scene ${scene} (${narrationDuration.toFixed(2)}s) is clipped by its ${sceneWindow}s window`,
        );
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
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
