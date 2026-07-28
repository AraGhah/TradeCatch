/**
 * Records /demo-video to a downloadable MP4 with narration + a subtle music bed.
 *
 * Usage: node scripts/record-demo-video.mjs [en|fr] [baseUrl]
 *
 * The page is loaded with ?record=1&voice=0, which renders the demo with no
 * player chrome and no in-page audio. Narration is muxed afterwards from the
 * pre-generated MP3s so it stays perfectly in sync with the scene windows.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const locale = (process.argv[2] || "en").toLowerCase() === "fr" ? "fr" : "en";
const baseUrl = process.argv[3] || "http://localhost:3003";
const pagePath =
  locale === "fr" ? "/fr/demo-video?record=1&voice=0" : "/demo-video?record=1&voice=0";

/** Read the scene windows straight from the timeline so they cannot drift. */
function readSceneDurations(loc) {
  const src = readFileSync(resolve("src/components/demo-video/timeline.ts"), "utf8");
  const block = src.match(
    new RegExp(`${loc}:\\s*\\{([^}]*)\\}`, "m"),
  );
  if (!block) throw new Error(`Could not read SCENE_DURATIONS_SEC.${loc} from timeline.ts`);
  const values = [...block[1].matchAll(/(\d+)\s*:\s*(\d+)/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => Number(m[2]));
  if (values.length !== 8) throw new Error(`Expected 8 scene durations, got ${values.length}`);
  return values;
}

const SCENE_DURATIONS_SEC = readSceneDurations(locale);
const TOTAL_SEC = SCENE_DURATIONS_SEC.reduce((a, b) => a + b, 0);
/** Extra wall-clock recorded past the end; trimmed off in the final encode. */
const TAIL_SEC = 2;

const outDir = resolve("public/demo-video/exports");
const tmpDir = join(outDir, ".tmp");
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

function run(cmd, args) {
  return new Promise((done, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? done() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

async function findFfmpeg() {
  try {
    await run("ffmpeg", ["-version"]);
    return "ffmpeg";
  } catch {
    const ffmpegStatic = (await import("ffmpeg-static")).default;
    if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  }
  throw new Error("ffmpeg not found");
}

/** Pads each narration clip out to its scene window and concatenates them. */
async function buildNarrationTrack(ffmpeg, outWav) {
  const narrDir = resolve(`public/demo-video/narration/${locale}`);
  const parts = [];

  for (let i = 0; i < SCENE_DURATIONS_SEC.length; i += 1) {
    const sceneId = i + 1;
    const duration = SCENE_DURATIONS_SEC[i];
    const padded = join(tmpDir, `${locale}-scene-${sceneId}.wav`);

    await run(ffmpeg, [
      "-y",
      "-i",
      join(narrDir, `scene-${sceneId}.mp3`),
      "-af",
      `adelay=250|250,apad=whole_dur=${duration}`,
      "-t",
      String(duration),
      "-ar",
      "48000",
      "-ac",
      "2",
      padded,
    ]);

    parts.push(`file '${padded.replace(/\\/g, "/")}'`);
  }

  const listFile = join(tmpDir, `concat-${locale}.txt`);
  writeFileSync(listFile, parts.join("\n"), "utf8");

  await run(ffmpeg, [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-c:a",
    "pcm_s16le",
    outWav,
  ]);
}

/**
 * A low, lowpassed drone chord with a slow tremolo. It reads as atmosphere
 * under the voice rather than as a tune competing with it.
 */
const musicExpr =
  "aevalsrc=" +
  "0.30*sin(2*PI*110*t)" +
  "+0.20*sin(2*PI*164.81*t)" +
  "+0.13*sin(2*PI*220*t)" +
  "+0.07*sin(2*PI*329.63*t)" +
  `:d=${TOTAL_SEC}:s=48000`;

async function main() {
  console.log(`Recording ${locale.toUpperCase()} demo — ${TOTAL_SEC}s — ${baseUrl}${pagePath}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"],
  });

  // recordVideo captures in CSS pixels, so a larger size or deviceScaleFactor
  // only pads the frame instead of supersampling it. Keep the capture native.
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: tmpDir, size: { width: 1920, height: 1080 } },
  });
  const recordingStartedAt = Date.now();

  const page = await context.newPage();
  await page.goto(`${baseUrl}${pagePath}`, { waitUntil: "networkidle", timeout: 120000 });

  await page.addStyleTag({
    content: `
      nextjs-portal, [data-nextjs-toast], [data-nextjs-dialog-overlay] { display: none !important; }
      body.demo-video-active header, body.demo-video-active footer { display: none !important; }
      html, body { background: #0c141e !important; }
    `,
  });

  // Let fonts and the first frame settle so the trim never lands on a blank.
  await page.waitForTimeout(1200);

  const playOffsetSec = (Date.now() - recordingStartedAt) / 1000;
  await page.keyboard.press("Space");

  console.log(`Playback started at +${playOffsetSec.toFixed(2)}s. Capturing…`);
  await page.waitForTimeout((TOTAL_SEC + TAIL_SEC) * 1000);

  const video = page.video();
  await page.close();
  await context.close();
  await browser.close();
  if (!video) throw new Error("No video recorded");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = `TradeCatch-Demo-${locale.toUpperCase()}-${stamp}`;
  const webmOut = join(tmpDir, `${base}.webm`);
  renameSync(await video.path(), webmOut);

  const ffmpeg = await findFfmpeg();
  const narrationWav = join(tmpDir, `${locale}-narration.wav`);
  await buildNarrationTrack(ffmpeg, narrationWav);

  const mp4Out = join(outDir, `${base}.mp4`);
  const filter = [
    `[2:a]volume=0.055,lowpass=f=950,tremolo=f=0.22:d=0.35`,
    `,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, TOTAL_SEC - 3)}:d=3[music]`,
    `;[1:a][music]amix=inputs=2:duration=first:normalize=0[mix]`,
    `;[mix]loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.97[a]`,
  ].join("");

  await run(ffmpeg, [
    "-y",
    // Input seek on the video only: drops the pre-roll and the blank first
    // frame without shifting the narration, which already starts at zero.
    "-ss",
    playOffsetSec.toFixed(3),
    "-i",
    webmOut,
    "-i",
    narrationWav,
    "-f",
    "lavfi",
    "-i",
    musicExpr,
    "-filter_complex",
    filter,
    "-map",
    "0:v:0",
    "-map",
    "[a]",
    "-t",
    String(TOTAL_SEC),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    // Deliberately generous for the content: dark gradients and small UI text
    // band and smear badly once a social platform re-compresses the file.
    "-b:v",
    "7M",
    "-maxrate",
    "9M",
    "-bufsize",
    "14M",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-b:a",
    "224k",
    "-movflags",
    "+faststart",
    mp4Out,
  ]);

  console.log(`\nDone — ${TOTAL_SEC}s\n${mp4Out}`);
  return mp4Out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
