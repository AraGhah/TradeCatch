/**
 * The one public demo video: "Under the sink". It is built from
 * Videos/ads_v2 (see PRODUCTION_NOTES.md there) and exported for the web at
 * 720x900 (4:5) with sidecar WebVTT captions generated from the real voice
 * timings (Videos/ads_v2/_source/captions.py). Captions are a separate track
 * the viewer can switch off; nothing is burned into the picture.
 *
 * Why this one: it shows exactly what Essential does (the receptionist answers,
 * takes the caller's details and sends the team an appointment request that
 * the team confirms). It does not show a call transfer, voice cloning or any
 * feature that is not part of the launch plans.
 *
 * "The ladder" and "After hours" (and the 16:9 platform and missed-call cuts in
 * cuts.ts) stay in the repository but are not offered on the public site:
 * "After hours" shows a call being transferred and the 16:9 platform cut shows
 * a transfer scene, and TradeCatch must never present a transfer as something
 * it does. To bring one back, add its id here and its copy under
 * `demoVideo.<copyKey>` and `demoStories.cards.<copyKey>`.
 *
 * The video is a fictional business, not a customer story. The player shows
 * `demoVideo.underTheSink.disclosure` under it.
 */
import type { DemoLocale } from "@/components/demo-video/cuts";

export type StoryId = "under-the-sink";

export const STORY_IDS: readonly StoryId[] = ["under-the-sink"];

/** The demo every "watch the demo" button opens. */
export const DEFAULT_STORY_ID: StoryId = "under-the-sink";

/** Namespace under `demoVideo` (player) and `demoStories.cards` (cards). */
export const STORY_COPY_KEY = {
  "under-the-sink": "underTheSink",
} as const satisfies Record<StoryId, string>;

export type StoryCopyKey = (typeof STORY_COPY_KEY)[StoryId];

type StoryMedia = {
  video: Record<DemoLocale, string>;
  captions: Record<DemoLocale, string>;
  poster: string;
  /** Running time in seconds, per locale (cards show it as m:ss). */
  seconds: Record<DemoLocale, number>;
};

const BASE = "/demo-video/stories";

function story(id: StoryId, seconds: Record<DemoLocale, number>): StoryMedia {
  return {
    video: { en: `${BASE}/${id}-en.mp4`, fr: `${BASE}/${id}-fr.mp4` },
    captions: {
      en: `${BASE}/captions/${id}-en.vtt`,
      fr: `${BASE}/captions/${id}-fr.vtt`,
    },
    poster: `${BASE}/${id}-poster.jpg`,
    seconds,
  };
}

export const STORY_MEDIA: Record<StoryId, StoryMedia> = {
  "under-the-sink": story("under-the-sink", { en: 44, fr: 49 }),
};

export function isStoryId(value: string): value is StoryId {
  return (STORY_IDS as readonly string[]).includes(value);
}

export function formatRunTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
