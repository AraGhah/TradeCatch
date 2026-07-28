/**
 * Measures each narration MP3 and prints the SCENE_DURATIONS_SEC block to paste
 * into src/components/demo-video/timeline.ts.
 *
 * Scene length = narration length + PAD, so there is never a silent gap longer
 * than PAD seconds and no sentence is ever cut off.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PAD = 1.3;

function ffmpegBin() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {
    return path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg.exe");
  }
}

const ffmpeg = ffmpegBin();

function durationOf(file) {
  let stderr = "";
  try {
    execFileSync(ffmpeg, ["-i", file], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    stderr = err.stderr?.toString() ?? "";
  }
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!match) throw new Error(`could not read duration of ${file}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

const result = {};
for (const locale of ["en", "fr"]) {
  result[locale] = {};
  for (let scene = 1; scene <= 8; scene += 1) {
    const file = path.join(ROOT, "public", "demo-video", "narration", locale, `scene-${scene}.mp3`);
    if (!existsSync(file)) {
      console.error(`missing ${file}`);
      process.exit(1);
    }
    const raw = durationOf(file);
    result[locale][scene] = { raw, rounded: Math.max(4, Math.ceil(raw + PAD)) };
  }
}

for (const locale of ["en", "fr"]) {
  const entries = Object.entries(result[locale]);
  const total = entries.reduce((sum, [, v]) => sum + v.rounded, 0);
  console.log(`\n${locale} — total ${total}s (${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")})`);
  for (const [scene, v] of entries) {
    console.log(`  scene ${scene}: narration ${v.raw.toFixed(2)}s → window ${v.rounded}s`);
  }
}

console.log("\nPaste into timeline.ts:\n");
console.log("export const SCENE_DURATIONS_SEC: Record<DemoLocale, Record<SceneId, number>> = {");
for (const locale of ["en", "fr"]) {
  const body = Object.entries(result[locale])
    .map(([scene, v]) => `${scene}: ${v.rounded}`)
    .join(", ");
  console.log(`  ${locale}: { ${body} },`);
}
console.log("};");
