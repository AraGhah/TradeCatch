/**
 * Demo-video media helpers, all driven by src/components/demo-video/cuts.ts.
 *
 *   npx tsx scripts/demo-media.ts script     JSON plan for generate-demo-narration.py
 *   npx tsx scripts/demo-media.ts captions   writes public/demo-video/captions/*.vtt
 *   npx tsx scripts/demo-media.ts windows    JSON scene windows + media paths (recorder, media check)
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  CUT_MEDIA,
  CUT_SCRIPTS,
  DEMO_CUTS,
  DEMO_LOCALES,
  LAYOUT,
  TTS_RATES,
  TTS_VOICES,
  spokenText,
} from "../src/components/demo-video/cuts";

// The timeline reads narration-timing.json, which `script` exists to produce,
// so it is only loaded by the commands that need it.
const loadTimeline = () => import("../src/components/demo-video/timeline");

const ROOT = path.resolve(__dirname, "..");

function vttTime(sec: number) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(rest, 3)}`;
}

function script() {
  const cuts: Record<string, Record<string, unknown[]>> = {};
  for (const cut of DEMO_CUTS) {
    cuts[cut] = {};
    for (const locale of DEMO_LOCALES) {
      cuts[cut][locale] = CUT_SCRIPTS[cut].map((scene) => ({
        minSec: scene.minSec,
        // The voice reads respelled text; captions keep the printed text.
        segments: scene.segments[locale].map((segment) => ({
          ...segment,
          text: spokenText(locale, segment.text),
        })),
      }));
    }
  }
  process.stdout.write(
    JSON.stringify({ voices: TTS_VOICES, rates: TTS_RATES, layout: LAYOUT, cuts }),
  );
}

async function captions() {
  const { captionsFor } = await loadTimeline();
  for (const cut of DEMO_CUTS) {
    for (const locale of DEMO_LOCALES) {
      const cues = captionsFor(cut, locale);
      const body = cues
        .map(
          (cue) =>
            `${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${cue.vttText}`,
        )
        .join("\n\n");
      const file = path.join(ROOT, "public", CUT_MEDIA[cut].captions[locale]);
      writeFileSync(file, `WEBVTT\n\n${body}\n`, "utf8");
      console.log(`wrote ${path.relative(ROOT, file)} (${cues.length} cues)`);
    }
  }
}

async function windows() {
  const { scenesFor } = await loadTimeline();
  const { HONESTY_MARKERS } = await import("../src/components/demo-video/cuts");
  const out: Record<string, Record<string, unknown>> = {};
  for (const cut of DEMO_CUTS) {
    out[cut] = {};
    for (const locale of DEMO_LOCALES) {
      out[cut][locale] = {
        durations: scenesFor(cut, locale).map((s) => s.duration),
        video: CUT_MEDIA[cut].video[locale],
        captions: CUT_MEDIA[cut].captions[locale],
        honesty: HONESTY_MARKERS[cut][locale],
      };
    }
  }
  process.stdout.write(JSON.stringify(out));
}

const command = process.argv[2];
if (command === "script") script();
else if (command === "captions") void captions();
else if (command === "windows") void windows();
else {
  console.error("usage: demo-media.ts script | captions | windows");
  process.exit(1);
}
