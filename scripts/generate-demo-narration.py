"""Generate the bilingual demo narration from src/components/demo-video/cuts.ts.

Usage:
    npx tsx scripts/demo-media.ts script | python scripts/generate-demo-narration.py

For every cut, locale and scene this:
  1. synthesizes each spoken line with edge-tts (cached by text/voice/rate),
  2. lays the lines out back to back and sizes the scene to fit them,
  3. mixes the lines into public/demo-video/narration/<cut>/<locale>/scene-N.mp3,
  4. writes src/components/demo-video/narration-timing.json, which the player,
     the captions and the recorder all read, so visuals can never drift from
     the audio.
"""
import asyncio
import hashlib
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
NARRATION_DIR = ROOT / "public" / "demo-video" / "narration"
CACHE_DIR = ROOT / ".artifacts" / "demo-video" / "tts"
TIMING_FILE = ROOT / "src" / "components" / "demo-video" / "narration-timing.json"


def ffmpeg_bin() -> str:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return "ffmpeg"
    except (OSError, subprocess.CalledProcessError):
        local = ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"
        if not local.exists():
            local = ROOT / "node_modules" / "ffmpeg-static" / "ffmpeg"
        return str(local)


FFMPEG = ffmpeg_bin()


def duration_of(path: Path) -> float:
    result = subprocess.run([FFMPEG, "-i", str(path)], capture_output=True, text=True)
    match = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", result.stderr)
    if not match:
        raise RuntimeError(f"could not read duration of {path}")
    h, m, s = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


async def synthesize(text: str, voice: str, rate: str) -> Path:
    key = hashlib.sha1(f"{voice}|{rate}|-2Hz|{text}".encode("utf-8")).hexdigest()[:16]
    path = CACHE_DIR / f"{key}.mp3"
    if path.exists() and path.stat().st_size > 0:
        return path
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        try:
            await edge_tts.Communicate(text, voice, rate=rate, pitch="-2Hz").save(str(path))
            return path
        except Exception:  # transient websocket failures are common
            if attempt == 3:
                raise
            await asyncio.sleep(2 * (attempt + 1))
    return path


def round_up_half(value: float) -> float:
    return math.ceil(value * 2) / 2


def mix_scene(clips: list[tuple[Path, float]], duration: float, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    args = [FFMPEG, "-y", "-loglevel", "error"]
    for path, _ in clips:
        args += ["-i", str(path)]
    filters = []
    labels = []
    for i, (_, start) in enumerate(clips):
        ms = int(round(start * 1000))
        filters.append(f"[{i}:a]aresample=24000,adelay={ms}:all=1[a{i}]")
        labels.append(f"[a{i}]")
    filters.append(
        f"{''.join(labels)}amix=inputs={len(clips)}:normalize=0:duration=longest,"
        f"apad=whole_dur={duration}[out]"
    )
    args += [
        "-filter_complex", ";".join(filters),
        "-map", "[out]",
        "-t", str(duration),
        "-ac", "1", "-ar", "24000", "-b:a", "48k",
        str(out),
    ]
    subprocess.run(args, check=True)


async def main() -> None:
    plan = json.load(sys.stdin)
    voices = plan["voices"]
    rates = plan["rates"]
    layout = plan["layout"]
    timing: dict = {}

    for cut, locales in plan["cuts"].items():
        timing[cut] = {}
        for locale, scenes in locales.items():
            timing[cut][locale] = []
            for index, scene in enumerate(scenes, start=1):
                cursor = layout["leadIn"]
                previous = None
                placed = []
                clips: list[tuple[Path, float]] = []
                for segment in scene["segments"]:
                    voice = segment["voice"]
                    if previous is not None:
                        narrative = "narrator" in (voice, previous) or "none" in (voice, previous)
                        cursor += layout["narratorGap"] if narrative else layout["dialogueGap"]
                    start = cursor
                    if voice == "none":
                        length = float(segment.get("holdSec", 3))
                    else:
                        clip = await synthesize(segment["text"], voices[locale][voice], rates[locale][voice])
                        length = duration_of(clip)
                        clips.append((clip, start))
                    cursor = start + length
                    placed.append({"start": round(start, 2), "end": round(cursor, 2)})
                    previous = voice

                duration = max(float(scene["minSec"]), round_up_half(cursor + layout["tail"]))
                out = NARRATION_DIR / cut / locale / f"scene-{index}.mp3"
                mix_scene(clips, duration, out)
                timing[cut][locale].append({"duration": duration, "segments": placed})
                print(f"{cut} {locale} scene {index}: {duration:.1f}s ({len(placed)} lines)")

            total = sum(s["duration"] for s in timing[cut][locale])
            print(f"== {cut} {locale}: {total:.1f}s")

    TIMING_FILE.write_text(json.dumps(timing, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {TIMING_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    asyncio.run(main())
