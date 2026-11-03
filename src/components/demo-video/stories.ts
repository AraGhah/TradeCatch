/**
 * The three short "on the job" dramatizations (Under the sink, The ladder,
 * After hours). They are built from Videos/ads_v2 (see PRODUCTION_NOTES.md
 * there) and exported for the web at 720x900 (4:5) with sidecar WebVTT
 * captions generated from the real voice timings (Videos/ads_v2/_source/captions.py).
 *
 * They are separate from the two scripted product cuts in cuts.ts: those are
 * 16:9 and feed the interactive /demo-video experience, these are portrait
 * and only play in the WatchDemoButton dialog.
 *
 * Honesty rules shared with cuts.ts: fictional business, not a customer story,
 * and the receptionist / transfer / text-back features are a pilot. Every story
 * has a `disclosure` string in messages (demoVideo.<copyKey>.disclosure) that
 * the player shows under the video.
 */
import type { DemoLocale } from "@/components/demo-video/cuts";

export type StoryId = "under-the-sink" | "the-ladder" | "after-hours";

export const STORY_IDS: readonly StoryId[] = [
  "under-the-sink",
  "the-ladder",
  "after-hours",
];

/** Namespace under `demoVideo` (player) and `demoStories.cards` (cards). */
export const STORY_COPY_KEY = {
  "under-the-sink": "underTheSink",
  "the-ladder": "theLadder",
  "after-hours": "afterHours",
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
  "the-ladder": story("the-ladder", { en: 30, fr: 32 }),
  "after-hours": story("after-hours", { en: 31, fr: 33 }),
};

export function isStoryId(value: string): value is StoryId {
  return (STORY_IDS as readonly string[]).includes(value);
}

export function formatRunTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
