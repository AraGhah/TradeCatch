"""Build the website's one public demo ("Under the sink", EN + FR) end to end.

    python build_site_demo.py [en] [fr] [--no-render]

What it does, in order, for each language:
  1. plans and renders the 9:16 master, then the 4:5 picture over the same audio (the site card is 4:5),
  2. web-encodes the 4:5 file to 720x900 (H.264 CRF 22, AAC 128k, 24 fps, faststart) at normal speed,
  3. writes the WebVTT captions from the exact moments the mixer placed each spoken line.
Outputs go to ../../../public/demo-video/stories/ (video + captions/). Intermediates and the 9:16 master are left in the
scratch folder (config.WORK / "site_demo"); the LinkedIn masters in Videos/ads_v2/ are NOT touched.

The only difference from the LinkedIn masters is the on-screen disclosure: the site shows "Dramatization with a fictional
business." (the launch plans are no longer described as a pilot), while the LinkedIn masters keep their longer line. Requires
the voice assets (gen_voice.py) and words.json (gen_words.py) to be current."""
import sys, subprocess
from pathlib import Path
import config as C
import build_ads as B
import captions as CAP
from audio_util import FF

SITE_LEGAL = {
    "en": "Dramatization with a fictional business.",
    "fr": "Mise en scène avec une entreprise fictive.",
}
STORIES = C.REPO / "public" / "demo-video" / "stories"
OUT = C.WORK / "site_demo"


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-800:])


def web_encode(src, dst):
    """The documented site encode (PRODUCTION_NOTES.md, "Website"): 720x900, normal speed, 24 fps.
    A peak limiter (-2 dBFS) runs before AAC: re-encoding a -1.5 dBTP master at 128 kbps otherwise overshoots (the FR file
    measured +1.4 dBTP without it). It touches only the loudest peaks; integrated loudness stays at about -14 LUFS."""
    run([FF, "-v", "error", "-y", "-i", str(src), "-vf", "scale=720:900:flags=lanczos",
         "-af", "alimiter=limit=0.794:attack=5:release=60:level=0",
         "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-maxrate", "2800k", "-bufsize", "5600k",
         "-pix_fmt", "yuv420p", "-r", "24", "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
         "-movflags", "+faststart", str(dst)])


def build(lang, render):
    C.BRAND[lang]["legal"] = SITE_LEGAL[lang]
    OUT.mkdir(parents=True, exist_ok=True)
    B.OUTDIR = OUT                                            # keep the LinkedIn masters untouched
    master = OUT / f"TradeCatch_A_UnderTheSink_{lang.upper()}_9x16.mp4"
    feed = OUT / f"TradeCatch_A_UnderTheSink_{lang.upper()}_4x5.mp4"

    C.set_format("9x16")
    ad = B.build_A(lang)
    print(f"[{lang}] planned {ad.t:.2f}s, {len(ad.items)} segments", flush=True)
    cues = CAP.cues_for(ad, lang)
    if not render:
        return ad, cues
    ad.render("bed_A")
    C.set_format("4x5")
    B.build_A(lang).render_picture(master)

    web = STORIES / f"under-the-sink-{lang}.mp4"
    web_encode(feed, web)
    vtt = STORIES / "captions" / f"under-the-sink-{lang}.vtt"
    vtt.write_text(CAP.vtt(cues), encoding="utf-8")
    print(f"[{lang}] wrote {web.name} ({web.stat().st_size/1e6:.1f} MB) and {vtt.name} ({len(cues)} cues)", flush=True)
    return ad, cues


if __name__ == "__main__":
    langs = [a for a in sys.argv[1:] if a in ("en", "fr")] or ["en", "fr"]
    for lang in langs:
        build(lang, "--no-render" not in sys.argv)
