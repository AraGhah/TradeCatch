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
  /^TradeCatch-(Demo|Platform|MissedCall)-.*\.(mp4|webm)$/,
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

/** Scene windows, media paths and honesty markers, straight from the timeline. */
function timelineMedia() {
  try {
    return JSON.parse(
      execSync("npx tsx scripts/demo-media.ts windows", {
        cwd: ROOT,
        encoding: "utf8",
      }),
    );
  } catch (error) {
    errors.push(
      `Could not read the demo timeline: ${error instanceof Error ? error.message : error}`,
    );
    return {};
  }
}

const media = timelineMedia();

for (const [cut, locales] of Object.entries(media)) {
  for (const locale of LOCALES) {
    const entry = locales[locale];
    const label = `${cut} ${locale.toUpperCase()}`;
    if (!entry) {
      errors.push(`${label}: missing from the demo timeline`);
      continue;
    }
    const videoPath = path.join(ROOT, "public", entry.video);
    const captionsPath = path.join(ROOT, "public", entry.captions);

    try {
      const videoDuration = durationSeconds(videoPath);
      const expectedDuration = entry.durations.reduce((sum, value) => sum + value, 0);
      if (Math.abs(videoDuration - expectedDuration) > 0.75) {
        errors.push(
          `${label} MP4 is ${videoDuration.toFixed(2)}s but the timeline is ${expectedDuration}s`,
        );
      }

      const captions = fs.readFileSync(captionsPath, "utf8");
      const normalizedCaptions = captions.replace(/\s+/g, " ");
      if (!captions.replace(/^\uFEFF/, "").startsWith("WEBVTT")) {
        errors.push(`${label} captions do not start with WEBVTT`);
      }
      const captionEnd = lastCaptionEnd(captions);
      if (captionEnd === null || Math.abs(captionEnd - videoDuration) > 0.75) {
        errors.push(
          `${label} captions end at ${captionEnd ?? "unknown"}s but the MP4 is ${videoDuration.toFixed(2)}s`,
        );
      }
      for (const marker of entry.honesty) {
        if (!normalizedCaptions.includes(marker)) {
          errors.push(`${label} captions are missing honesty marker: ${marker}`);
        }
      }

      entry.durations.forEach((sceneWindow, i) => {
        const narrationPath = path.join(
          ROOT,
          "public/demo-video/narration",
          cut,
          locale,
          `scene-${i + 1}.mp3`,
        );
        const narrationDuration = durationSeconds(narrationPath);
        // Scene files are mixed to their exact window; anything else means the
        // timeline and the audio were generated from different scripts.
        if (Math.abs(narrationDuration - sceneWindow) > 0.3) {
          errors.push(
            `${label} narration scene ${i + 1} is ${narrationDuration.toFixed(2)}s but its window is ${sceneWindow}s`,
          );
        }
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
}

const demoMb = demoBytes / (1024 * 1024);
if (demoMb > MAX_TRACKED_DEMO_MB) {
  errors.push(
    `Tracked public/demo-video is ${demoMb.toFixed(1)} MB (max ${MAX_TRACKED_DEMO_MB}). Keep one optimized EN + FR MP4 per demo cut.`,
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
