"""Derive web-optimised encodes and poster frames from the finished 9:16 masters.

    python export.py            -> ads_v2/web/*.mp4 (720x1280, CRF 22, AAC 128k) and ads_v2/posters/*.jpg
Masters are never modified.
"""
import subprocess, re
from pathlib import Path
import config as C
from audio_util import FF

ADS = C.ADS_DIR
WEB = ADS / "web"; POSTERS = ADS / "posters"
WEB.mkdir(exist_ok=True); POSTERS.mkdir(exist_ok=True)

# poster = a still from the opening hook (a person in the situation), not the end card
POSTER_AT = {"A": 1.6, "B": 2.4, "C": 1.2}

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr[-600:])

for src in sorted(ADS.glob("TradeCatch_*_9x16.mp4")):
    m = re.match(r"TradeCatch_([ABC])_", src.name); key = m.group(1)
    web = WEB / src.name.replace("_9x16", "_9x16_web")
    run([FF, "-v", "error", "-y", "-i", str(src), "-vf", "scale=720:1280:flags=lanczos",
         "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "24",
         "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", str(web)])
    poster = POSTERS / (src.stem + ".jpg")
    run([FF, "-v", "error", "-y", "-ss", str(POSTER_AT[key]), "-i", str(src), "-frames:v", "1", "-q:v", "2", str(poster)])
    print(f"{src.name:46s} master {src.stat().st_size/1e6:5.1f} MB | web {web.stat().st_size/1e6:5.1f} MB | poster {poster.stat().st_size/1e3:5.0f} KB")
